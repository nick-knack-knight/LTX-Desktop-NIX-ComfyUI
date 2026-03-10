"""Application state composition root and dependency wiring."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from state.app_settings import AppSettings
from handlers import (
    DownloadHandler,
    GenerationHandler,
    HealthHandler,
    IcLoraHandler,
    ImageGenerationHandler,
    ModelsHandler,
    PipelinesHandler,
    SuggestGapPromptHandler,
    RetakeHandler,
    RuntimePolicyHandler,
    SettingsHandler,
    TextHandler,
    VideoGenerationHandler,
)
from runtime_config.runtime_config import RuntimeConfig
from services.interfaces import (
    A2VPipeline,
    FastVideoPipeline,
    ZitAPIClient,
    ImageGenerationPipeline,
    GpuCleaner,
    GpuInfo,
    HTTPClient,
    IcLoraModelDownloader,
    IcLoraPipeline,
    LTXAPIClient,
    ModelDownloader,
    RetakePipeline,
    TaskRunner,
    TextEncoder,
    VideoProcessor,
)
from state.app_state_types import AppState, StartupPending, TextEncoderState


class AppHandler:
    """Composition-only state service exposing typed domain handlers."""

    def __init__(
        self,
        config: RuntimeConfig,
        default_settings: AppSettings,
        http: HTTPClient,
        gpu_cleaner: GpuCleaner,
        model_downloader: ModelDownloader,
        gpu_info: GpuInfo,
        video_processor: VideoProcessor,
        text_encoder: TextEncoder,
        task_runner: TaskRunner,
        ltx_api_client: LTXAPIClient,
        zit_api_client: ZitAPIClient,
        fast_video_pipeline_class: type[FastVideoPipeline],
        image_generation_pipeline_class: type[ImageGenerationPipeline],
        ic_lora_pipeline_class: type[IcLoraPipeline],
        a2v_pipeline_class: type[A2VPipeline],
        retake_pipeline_class: type[RetakePipeline],
        ic_lora_model_downloader: IcLoraModelDownloader,
    ) -> None:
        self.config = config

        # Exposed for tests and diagnostics.
        self.http = http
        self.gpu_cleaner = gpu_cleaner
        self.model_downloader = model_downloader
        self.gpu_info = gpu_info
        self.video_processor = video_processor
        self.task_runner = task_runner
        self.ltx_api_client = ltx_api_client
        self.zit_api_client = zit_api_client
        self.fast_video_pipeline_class = fast_video_pipeline_class
        self.image_generation_pipeline_class = image_generation_pipeline_class
        self.ic_lora_pipeline_class = ic_lora_pipeline_class
        self.a2v_pipeline_class = a2v_pipeline_class
        self.retake_pipeline_class = retake_pipeline_class
        self.ic_lora_model_downloader = ic_lora_model_downloader

        self._lock = threading.RLock()

        self.state = AppState(
            available_files={
                "checkpoint": None,
                "upsampler": None,
                "text_encoder": None,
                "zit": None,
            },
            downloading_session=None,
            gpu_slot=None,
            api_generation=None,
            cpu_slot=None,
            text_encoder=TextEncoderState(service=text_encoder),
            startup=StartupPending(message="Not started"),
            app_settings=default_settings.model_copy(deep=True),
        )

        # ============================================================
        # Handlers (wired in dependency order)
        # ============================================================

        self.settings = SettingsHandler(
            state=self.state,
            lock=self._lock,
            settings_file=config.settings_file,
        )
        self.settings.load_settings(default_settings)

        self.models = ModelsHandler(
            state=self.state,
            lock=self._lock,
            config=config,
        )

        self.downloads = DownloadHandler(
            state=self.state,
            lock=self._lock,
            models_handler=self.models,
            model_downloader=model_downloader,
            task_runner=task_runner,
            config=config,
        )

        self.text = TextHandler(
            state=self.state,
            lock=self._lock,
            config=config,
        )

        self.pipelines = PipelinesHandler(
            state=self.state,
            lock=self._lock,
            text_handler=self.text,
            gpu_cleaner=gpu_cleaner,
            fast_video_pipeline_class=fast_video_pipeline_class,
            image_generation_pipeline_class=image_generation_pipeline_class,
            ic_lora_pipeline_class=ic_lora_pipeline_class,
            a2v_pipeline_class=a2v_pipeline_class,
            retake_pipeline_class=retake_pipeline_class,
            config=config,
            outputs_dir=config.outputs_dir,
            device=config.device,
        )

        self.generation = GenerationHandler(state=self.state, lock=self._lock)

        self.video_generation = VideoGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            pipelines_handler=self.pipelines,
            text_handler=self.text,
            ltx_api_client=ltx_api_client,
            outputs_dir=config.outputs_dir,
            config=config,
            camera_motion_prompts=config.camera_motion_prompts,
            default_negative_prompt=config.default_negative_prompt,
        )

        self.image_generation = ImageGenerationHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            pipelines_handler=self.pipelines,
            outputs_dir=config.outputs_dir,
            config=config,
            zit_api_client=zit_api_client,
        )

        self.health = HealthHandler(
            state=self.state,
            lock=self._lock,
            models_handler=self.models,
            pipelines_handler=self.pipelines,
            gpu_info=gpu_info,
            config=config,
            use_sage_attention=config.use_sage_attention,
        )

        self.runtime_policy = RuntimePolicyHandler(config=config)

        self.suggest_gap_prompt = SuggestGapPromptHandler(
            state=self.state,
            lock=self._lock,
            http=http,
        )

        self.retake = RetakeHandler(
            state=self.state,
            lock=self._lock,
            ltx_api_client=ltx_api_client,
            config=config,
            generation_handler=self.generation,
            pipelines_handler=self.pipelines,
            text_handler=self.text,
            outputs_dir=config.outputs_dir,
        )

        self.ic_lora = IcLoraHandler(
            state=self.state,
            lock=self._lock,
            generation_handler=self.generation,
            pipelines_handler=self.pipelines,
            text_handler=self.text,
            video_processor=video_processor,
            ic_lora_model_downloader=ic_lora_model_downloader,
            ic_lora_dir=config.ic_lora_dir,
            outputs_dir=config.outputs_dir,
        )

        self.downloads.cleanup_downloading_dir()
        self.models.refresh_available_files()


@dataclass
class ServiceBundle:
    http: HTTPClient
    gpu_cleaner: GpuCleaner
    model_downloader: ModelDownloader
    gpu_info: GpuInfo
    video_processor: VideoProcessor
    text_encoder: TextEncoder
    task_runner: TaskRunner
    ltx_api_client: LTXAPIClient
    zit_api_client: ZitAPIClient
    fast_video_pipeline_class: type[FastVideoPipeline]
    image_generation_pipeline_class: type[ImageGenerationPipeline]
    ic_lora_pipeline_class: type[IcLoraPipeline]
    a2v_pipeline_class: type[A2VPipeline]
    retake_pipeline_class: type[RetakePipeline]
    ic_lora_model_downloader: IcLoraModelDownloader


def build_default_service_bundle(config: RuntimeConfig) -> ServiceBundle:
    """Build real runtime services with lazy heavy imports isolated from tests."""
    from services.fast_video_pipeline.ltx_fast_video_pipeline import LTXFastVideoPipeline
    from services.zit_api_client.zit_api_client_impl import ZitAPIClientImpl
    from services.gpu_cleaner.torch_cleaner import TorchCleaner
    from services.gpu_info.gpu_info_impl import GpuInfoImpl
    from services.http_client.http_client_impl import HTTPClientImpl
    from services.ic_lora_model_downloader.ic_lora_model_downloader_impl import IcLoraModelDownloaderImpl
    from services.a2v_pipeline.ltx_a2v_pipeline import LTXa2vPipeline
    from services.ic_lora_pipeline.ltx_ic_lora_pipeline import LTXIcLoraPipeline
    from services.image_generation_pipeline.zit_image_generation_pipeline import ZitImageGenerationPipeline
    from services.ltx_api_client.ltx_api_client_impl import LTXAPIClientImpl
    from services.model_downloader.hugging_face_downloader import HuggingFaceDownloader
    from services.retake_pipeline.ltx_retake_pipeline import LTXRetakePipeline
    from services.task_runner.threading_runner import ThreadingRunner
    from services.text_encoder.ltx_text_encoder import LTXTextEncoder
    from services.video_processor.video_processor_impl import VideoProcessorImpl

    http = HTTPClientImpl()

    return ServiceBundle(
        http=http,
        gpu_cleaner=TorchCleaner(device=config.device),
        model_downloader=HuggingFaceDownloader(),
        gpu_info=GpuInfoImpl(),
        video_processor=VideoProcessorImpl(),
        text_encoder=LTXTextEncoder(
            device=config.device,
            http=http,
            ltx_api_base_url=config.ltx_api_base_url,
        ),
        task_runner=ThreadingRunner(),
        ltx_api_client=LTXAPIClientImpl(http=http, ltx_api_base_url=config.ltx_api_base_url),
        zit_api_client=ZitAPIClientImpl(http=http),
        fast_video_pipeline_class=LTXFastVideoPipeline,
        image_generation_pipeline_class=ZitImageGenerationPipeline,
        ic_lora_pipeline_class=LTXIcLoraPipeline,
        a2v_pipeline_class=LTXa2vPipeline,
        retake_pipeline_class=LTXRetakePipeline,
        ic_lora_model_downloader=IcLoraModelDownloaderImpl(),
    )


def build_initial_state(
    config: RuntimeConfig,
    default_settings: AppSettings,
    service_bundle: ServiceBundle | None = None,
) -> AppHandler:
    bundle = service_bundle or build_default_service_bundle(config)

    return AppHandler(
        config=config,
        default_settings=default_settings,
        http=bundle.http,
        gpu_cleaner=bundle.gpu_cleaner,
        model_downloader=bundle.model_downloader,
        gpu_info=bundle.gpu_info,
        video_processor=bundle.video_processor,
        text_encoder=bundle.text_encoder,
        task_runner=bundle.task_runner,
        ltx_api_client=bundle.ltx_api_client,
        zit_api_client=bundle.zit_api_client,
        fast_video_pipeline_class=bundle.fast_video_pipeline_class,
        image_generation_pipeline_class=bundle.image_generation_pipeline_class,
        ic_lora_pipeline_class=bundle.ic_lora_pipeline_class,
        a2v_pipeline_class=bundle.a2v_pipeline_class,
        retake_pipeline_class=bundle.retake_pipeline_class,
        ic_lora_model_downloader=bundle.ic_lora_model_downloader,
    )


# ---------------------------------------------------------------------------
# No-op stubs for ML pipeline classes — used in ComfyUI mode where all
# inference is handled remotely.  These classes satisfy the Protocol
# interfaces at the structural level; none of them are ever instantiated
# (create() raises NotImplementedError) because the ComfyUI generation path
# bypasses the local pipeline loader entirely.
# ---------------------------------------------------------------------------

class _NoopGpuCleaner:
    def cleanup(self) -> None:
        pass


class _NoopTextEncoder:
    def install_patches(self, state_getter: object) -> None:  # type: ignore[override]
        pass

    def encode_via_api(  # type: ignore[override]
        self,
        prompt: str,
        api_key: str,
        checkpoint_path: str,
        enhance_prompt: bool,
    ) -> object:
        return None


def _noop_pipeline_create(*args: object, **kwargs: object) -> object:
    raise NotImplementedError("Local ML pipeline not available in ComfyUI mode")


class _NoopFastVideoPipeline:
    pipeline_kind = "fast"

    @staticmethod
    def create(  # type: ignore[override]
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        device: object,
    ) -> "_NoopFastVideoPipeline":
        raise NotImplementedError("Local LTX pipeline not available in ComfyUI mode")

    def generate(self, **_kwargs: object) -> None:  # type: ignore[override]
        raise NotImplementedError("Local LTX pipeline not available in ComfyUI mode")

    def warmup(self, output_path: str) -> None:
        pass

    def compile_transformer(self) -> None:
        pass


class _NoopA2VPipeline:
    @staticmethod
    def create(  # type: ignore[override]
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        device: object,
    ) -> "_NoopA2VPipeline":
        raise NotImplementedError("Local A2V pipeline not available in ComfyUI mode")

    def generate(self, **_kwargs: object) -> None:  # type: ignore[override]
        raise NotImplementedError("Local A2V pipeline not available in ComfyUI mode")


class _NoopImageGenerationPipeline:
    @staticmethod
    def create(model_path: str, device: object = None) -> "_NoopImageGenerationPipeline":  # type: ignore[override]
        raise NotImplementedError("Local image pipeline not available in ComfyUI mode")

    def generate(self, **_kwargs: object) -> object:  # type: ignore[override]
        raise NotImplementedError("Local image pipeline not available in ComfyUI mode")

    def to(self, device: str) -> None:
        pass


class _NoopIcLoraPipeline:
    @staticmethod
    def create(  # type: ignore[override]
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        lora_path: str,
        device: object,
    ) -> "_NoopIcLoraPipeline":
        raise NotImplementedError("Local IC-LoRA pipeline not available in ComfyUI mode")

    def generate(self, **_kwargs: object) -> None:  # type: ignore[override]
        raise NotImplementedError("Local IC-LoRA pipeline not available in ComfyUI mode")


class _NoopRetakePipeline:
    @staticmethod
    def create(  # type: ignore[override]
        checkpoint_path: str,
        gemma_root: str | None,
        device: object,
        *,
        loras: object = None,
        quantization: object = None,
    ) -> "_NoopRetakePipeline":
        raise NotImplementedError("Local retake pipeline not available in ComfyUI mode")

    def generate(self, **_kwargs: object) -> None:  # type: ignore[override]
        raise NotImplementedError("Local retake pipeline not available in ComfyUI mode")


def build_comfyui_service_bundle(config: RuntimeConfig) -> ServiceBundle:
    """Build services for ComfyUI mode — no torch or local GPU required.

    Real network/IO services are used as-is.  Local ML pipeline classes are
    replaced with no-op stubs that raise NotImplementedError if somehow
    called; in practice they are never instantiated because
    _generate_comfyui() bypasses the local pipeline loader.
    """
    from services.http_client.http_client_impl import HTTPClientImpl
    from services.ic_lora_model_downloader.ic_lora_model_downloader_impl import IcLoraModelDownloaderImpl
    from services.ltx_api_client.ltx_api_client_impl import LTXAPIClientImpl
    from services.model_downloader.hugging_face_downloader import HuggingFaceDownloader
    from services.gpu_info.gpu_info_impl import GpuInfoImpl
    from services.task_runner.threading_runner import ThreadingRunner
    from services.video_processor.video_processor_impl import VideoProcessorImpl
    from services.zit_api_client.zit_api_client_impl import ZitAPIClientImpl

    http = HTTPClientImpl()

    return ServiceBundle(
        http=http,
        gpu_cleaner=_NoopGpuCleaner(),  # type: ignore[arg-type]
        model_downloader=HuggingFaceDownloader(),
        gpu_info=GpuInfoImpl(),
        video_processor=VideoProcessorImpl(),
        text_encoder=_NoopTextEncoder(),  # type: ignore[arg-type]
        task_runner=ThreadingRunner(),
        ltx_api_client=LTXAPIClientImpl(http=http, ltx_api_base_url=config.ltx_api_base_url),
        zit_api_client=ZitAPIClientImpl(http=http),
        fast_video_pipeline_class=_NoopFastVideoPipeline,  # type: ignore[arg-type]
        image_generation_pipeline_class=_NoopImageGenerationPipeline,  # type: ignore[arg-type]
        ic_lora_pipeline_class=_NoopIcLoraPipeline,  # type: ignore[arg-type]
        a2v_pipeline_class=_NoopA2VPipeline,  # type: ignore[arg-type]
        retake_pipeline_class=_NoopRetakePipeline,  # type: ignore[arg-type]
        ic_lora_model_downloader=IcLoraModelDownloaderImpl(),
    )
