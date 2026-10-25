# The live GPU demo's model on RunPod Serverless (plan.md §13, docs/gpu-demo.md), for RunPod's
# "deploy from GitHub" flow: Dockerfile path `deploy/runpod/Dockerfile`, endpoint type Queue.
#
# It is RunPod's own vLLM worker with Tempo's settings baked in (the same values as
# worker.gpu-demo.env). The worker's handler, and its runpod.serverless.start(), live in the base
# image, so RunPod's "Could not find runpod.serverless.start() in your repo" notice is expected.
# The model downloads when a worker first starts; attach a network volume to keep it between
# cold starts.
FROM runpod/worker-v1-vllm:v2.30.1

ENV MODEL_NAME=Qwen/Qwen2.5-VL-7B-Instruct \
    OPENAI_SERVED_MODEL_NAME_OVERRIDE=tempo-private \
    MAX_MODEL_LEN=8192 \
    GPU_MEMORY_UTILIZATION=0.92 \
    MAX_NUM_SEQS=8 \
    LIMIT_MM_PER_PROMPT="{\"image\":1,\"video\":0}" \
    MM_PROCESSOR_KWARGS="{\"max_pixels\":1003520}" \
    DISABLE_LOG_REQUESTS=true \
    DISABLE_LOG_STATS=true \
    ENABLE_PREFIX_CACHING=false \
    VLLM_NO_USAGE_STATS=1 \
    DO_NOT_TRACK=1
