"""Kyutai TTS 1.6B (MLX, local, free): speak a text file, save a WAV and the
engine's own word start times. Run with the tts16b venv python."""
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "huggingface_hub",
#     "moshi_mlx==0.2.12",
#     "numpy",
#     # ]
# ///

import argparse
import json
import sys
import time

import mlx.core as mx
import mlx.nn as nn
import numpy as np
import sentencepiece
import sphn
from moshi_mlx import models
from moshi_mlx.client_utils import make_log
from moshi_mlx.models.tts import (
    DEFAULT_DSM_TTS_REPO,
    DEFAULT_DSM_TTS_VOICE_REPO,
    TTSModel,
)
from moshi_mlx.utils.loaders import hf_get


def log(level: str, msg: str):
    print(make_log(level, msg))


def main():
    parser = argparse.ArgumentParser(
        description="Run Kyutai TTS using the MLX implementation"
    )
    parser.add_argument("inp", type=str, help="Text file to speak")
    parser.add_argument("out", type=str, help="Output .wav")
    parser.add_argument("--timings", required=True, help="Output JSON of engine word timings")
    parser.add_argument(
        "--hf-repo",
        type=str,
        default=DEFAULT_DSM_TTS_REPO,
        help="HF repo in which to look for the pretrained models.",
    )
    parser.add_argument(
        "--voice-repo",
        default=DEFAULT_DSM_TTS_VOICE_REPO,
        help="HF repo in which to look for pre-computed voice embeddings.",
    )
    parser.add_argument(
        "--voice", default="expresso/ex03-ex01_happy_001_channel1_334s.wav"
    )
    parser.add_argument(
        "--quantize",
        type=int,
        help="The quantization to be applied, e.g. 8 for 8 bits.",
    )
    args = parser.parse_args()

    mx.random.seed(299792458)

    log("info", "retrieving checkpoints")

    raw_config = hf_get("config.json", args.hf_repo)
    with open(hf_get(raw_config), "r") as fobj:
        raw_config = json.load(fobj)

    mimi_weights = hf_get(raw_config["mimi_name"], args.hf_repo)
    moshi_name = raw_config.get("moshi_name", "model.safetensors")
    moshi_weights = hf_get(moshi_name, args.hf_repo)
    tokenizer = hf_get(raw_config["tokenizer_name"], args.hf_repo)
    lm_config = models.LmConfig.from_config_dict(raw_config)
    # There is a bug in moshi_mlx <= 0.3.0 handling of the ring kv cache.
    # The following line gets around it for now.
    lm_config.transformer.max_seq_len = lm_config.transformer.context
    model = models.Lm(lm_config)
    model.set_dtype(mx.bfloat16)

    log("info", f"loading model weights from {moshi_weights}")
    model.load_pytorch_weights(str(moshi_weights), lm_config, strict=True)

    if args.quantize is not None:
        log("info", f"quantizing model to {args.quantize} bits")
        nn.quantize(model.depformer, bits=args.quantize)
        for layer in model.transformer.layers:
            nn.quantize(layer.self_attn, bits=args.quantize)
            nn.quantize(layer.gating, bits=args.quantize)

    log("info", f"loading the text tokenizer from {tokenizer}")
    text_tokenizer = sentencepiece.SentencePieceProcessor(str(tokenizer))  # type: ignore

    log("info", f"loading the audio tokenizer {mimi_weights}")
    generated_codebooks = lm_config.generated_codebooks
    audio_tokenizer = models.mimi.Mimi(models.mimi_202407(generated_codebooks))
    audio_tokenizer.load_pytorch_weights(str(mimi_weights), strict=True)

    cfg_coef_conditioning = None
    tts_model = TTSModel(
        model,
        audio_tokenizer,
        text_tokenizer,
        voice_repo=args.voice_repo,
        temp=0.6,
        cfg_coef=1,
        max_padding=8,
        initial_padding=2,
        final_padding=2,
        padding_bonus=0,
        raw_config=raw_config,
    )
    if tts_model.valid_cfg_conditionings:
        # Model was trained with CFG distillation.
        cfg_coef_conditioning = tts_model.cfg_coef
        tts_model.cfg_coef = 1.0
        cfg_is_no_text = False
        cfg_is_no_prefix = False
    else:
        cfg_is_no_text = True
        cfg_is_no_prefix = True
    mimi = tts_model.mimi


    text_to_tts = open(args.inp, encoding="utf-8").read().strip()
    all_entries = [tts_model.prepare_script([text_to_tts])]
    voices = [tts_model.get_voice_path(args.voice)] if tts_model.multi_speaker else []
    all_attributes = [tts_model.make_condition_attributes(voices, cfg_coef_conditioning)]
    pcm = []
    def _on_frame(frame):
        if (frame == -1).any():
            return
        p = tts_model.mimi.decode_step(frame[:, :, None])
        pcm.append(np.array(mx.clip(p[0, 0], -1, 1)))
    begin = time.time()
    result = tts_model.generate(all_entries, all_attributes, cfg_is_no_prefix=cfg_is_no_prefix,
                                cfg_is_no_text=cfg_is_no_text, on_frame=_on_frame)
    wav = np.concat(pcm, -1)
    sphn.write_wav(args.out, wav, mimi.sample_rate)
    # Engine word timings: the step at which each word was fed to the model,
    # divided by the codec frame rate (12.5 steps per second). Only starts are
    # known; an end is taken as the next word's start.
    fr = mimi.frame_rate
    words = [{"w": w, "start": round(step / fr, 3)} for w, step in result.all_transcripts[0]]
    json.dump({"engine": "kyutai/tts-1.6b-en_fr", "voice": args.voice, "frame_rate": fr,
               "audio_seconds": round(len(wav) / mimi.sample_rate, 3), "words": words,
               "seconds_taken": round(time.time() - begin, 1)}, open(args.timings, "w"), indent=1)
    log("info", f"wrote {args.out} ({len(wav)/mimi.sample_rate:.1f}s) and {len(words)} word timings")


if __name__ == "__main__":
    main()
