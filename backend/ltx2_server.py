"""FastAPI composition root — ComfyUI-integrated LTX backend server.

All ML inference is delegated to ComfyUI over HTTP; this process owns only
the FastAPI/uvicorn layer, state management, and file I/O.  torch and any
GPU-specific libraries are intentionally NOT imported here.
"""

import os
import sys

if os.environ.get("BACKEND_DEBUG") == "1":
    try:
        import debugpy  # type: ignore[reportMissingImports]

        if not bool(debugpy.is_client_connected()):  # type: ignore[reportUnknownMemberType]
            try:
                debugpy.connect(("127.0.0.1", 5678))  # type: ignore[reportUnknownMemberType]
            except (ConnectionRefusedError, ConnectionError, OSError):
                debugpy.listen(("127.0.0.1", 5678))  # type: ignore[reportUnknownMemberType]
    except (ImportError, RuntimeError) as exc:
        print(f"Debugpy setup failed: {exc}", file=sys.stderr)

import logging
import platform
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging — write to stdout so Electron captures everything (including early
# import errors) in the session log file.
# ---------------------------------------------------------------------------
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
logging.basicConfig(level=logging.INFO, handlers=[console_handler])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PORT = 0


def _resolve_app_data_dir() -> Path:
    env_path = os.environ.get("LTX_APP_DATA_DIR")
    if not env_path:
        raise RuntimeError(
            "LTX_APP_DATA_DIR environment variable must be set. "
            "When running standalone, set it to the desired data directory."
        )
    candidate = Path(env_path)
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


APP_DATA_DIR = _resolve_app_data_dir()

MODELS_DIR = APP_DATA_DIR / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

OUTPUTS_DIR = APP_DATA_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

logger.info("Models directory: %s", MODELS_DIR)

IC_LORA_DIR = MODELS_DIR / "ic-loras"

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
SETTINGS_FILE = APP_DATA_DIR / "settings.json"

from state.app_settings import AppSettings

DEFAULT_APP_SETTINGS = AppSettings()

# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
from app_factory import DEFAULT_ALLOWED_ORIGINS, create_app
from app_handler import build_comfyui_service_bundle
from state import RuntimeConfig, build_initial_state
from runtime_config.model_download_specs import DEFAULT_MODEL_DOWNLOAD_SPECS
from server_utils.model_layout_migration import migrate_legacy_models_layout

migrate_legacy_models_layout(APP_DATA_DIR)
IC_LORA_DIR.mkdir(parents=True, exist_ok=True)

LTX_API_BASE_URL = "https://api.ltx.video"

CAMERA_MOTION_PROMPTS = {
    "none": "",
    "static": ", static camera, locked off shot, no camera movement",
    "focus_shift": ", focus shift, rack focus, changing focal point",
    "dolly_in": ", dolly in, camera pushing forward, smooth forward movement",
    "dolly_out": ", dolly out, camera pulling back, smooth backward movement",
    "dolly_left": ", dolly left, camera tracking left, lateral movement",
    "dolly_right": ", dolly right, camera tracking right, lateral movement",
    "jib_up": ", jib up, camera rising up, upward crane movement",
    "jib_down": ", jib down, camera lowering down, downward crane movement",
}

DEFAULT_NEGATIVE_PROMPT = (
    "blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, "
    "excessive noise, grainy texture, poor lighting, flickering, motion blur, distorted "
    "proportions, unnatural skin tones, deformed facial features, asymmetrical face, "
    "missing facial features, extra limbs, disfigured hands, wrong hand count, artifacts "
    "around text, inconsistent perspective, camera shake, incorrect depth of field"
)

runtime_config = RuntimeConfig(
    device=None,            # ComfyUI handles GPU — no local torch device
    models_dir=MODELS_DIR,
    model_download_specs=DEFAULT_MODEL_DOWNLOAD_SPECS,
    required_model_types=frozenset(),   # no local models required
    outputs_dir=OUTPUTS_DIR,
    ic_lora_dir=IC_LORA_DIR,
    settings_file=SETTINGS_FILE,
    ltx_api_base_url=LTX_API_BASE_URL,
    force_api_generations=False,        # use _generate_comfyui(), not LTX API
    use_sage_attention=False,           # no local inference
    camera_motion_prompts=CAMERA_MOTION_PROMPTS,
    default_negative_prompt=DEFAULT_NEGATIVE_PROMPT,
)

handler = build_initial_state(
    runtime_config,
    DEFAULT_APP_SETTINGS,
    build_comfyui_service_bundle(runtime_config),
)

auth_token = os.environ.get("LTX_AUTH_TOKEN", "")

app = create_app(handler=handler, allowed_origins=DEFAULT_ALLOWED_ORIGINS, auth_token=auth_token)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import asyncio
    import socket as _socket

    import uvicorn

    port = int(os.environ.get("LTX_PORT", "") or PORT)

    logger.info("=" * 60)
    logger.info("LTX Video Server — ComfyUI mode (FastAPI + Uvicorn)")
    logger.info("Platform: %s (%s)", platform.system(), platform.machine())
    logger.info("Python:   %s", sys.version.split()[0])
    logger.info("Mode:     ComfyUI workflow (no local GPU inference)")
    logger.info("=" * 60)

    # Bind socket ourselves so we know the actual port before uvicorn starts.
    sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    actual_port = int(sock.getsockname()[1])

    # Route uvicorn logs to stdout so Electron captures them correctly.
    log_config: dict[str, object] = {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["default"], "level": "INFO"},
            "uvicorn.error": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["default"], "level": "INFO", "propagate": False},
        },
    }

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=actual_port,
        log_level="info",
        access_log=False,
        log_config=log_config,
    )
    server = uvicorn.Server(config)

    _orig_startup = server.startup

    async def _startup_with_ready_msg(sockets: list[_socket.socket] | None = None) -> None:
        await _orig_startup(sockets=sockets)
        if server.started:
            # Machine-parseable ready message — Electron matches this exact line.
            print(f"Server running on http://127.0.0.1:{actual_port}", flush=True)

    server.startup = _startup_with_ready_msg  # type: ignore[assignment]

    asyncio.run(server.serve(sockets=[sock]))
