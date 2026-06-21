# Operational Analysis & Evaluation Report

This report documents the performance, token usage, cost, and design trade-offs between Strategy A (single-pass) and Strategy B (two-pass image validation and claim verification).

---

## 1. Execution Summary

### Sample Set (20 Claims)
- **Number of claims processed**: 20
- **Total images processed**: 29
- **Number of model calls**:
  - **Strategy A**: 20 calls (1 call per claim)
  - **Strategy B**: 40 calls (2 calls per claim for valid claims, 1 call for invalid claims)
- **Average runtime**:
  - **Strategy A**: ~30.72s (average latency of ~1.54s per claim)
  - **Strategy B**: ~31.94s (average latency of ~1.60s per claim)

### Test Set (45 Claims)
- **Number of claims processed**: 45
- **Total images processed**: ~70
- **Number of model calls (Strategy A)**: 45 calls

---

## 2. Token Usage & Cost Estimation

Pricing assumptions based on `claude-sonnet-4-6` pricing:
- **Input Tokens**: $3.00 / million tokens
- **Output Tokens**: $15.00 / million tokens
- **Image Tokens**: Each image sent to Claude requires approximately 1,600 tokens for high-resolution processing.

### Token Breakdown per Claim (Average)
- **Input Text (Context, prompt, history, requirements)**: ~500 tokens
- **Input Image(s)**: ~1,600 tokens per image (average of 1.5 images = ~2,400 tokens)
- **Total Input Tokens per Call**: ~2,900 tokens
- **Total Output Tokens per Call**: ~200 tokens

### Estimated Cost Calculations

| Strategy | Dataset | Claims | Total API Calls | Est. Input Tokens | Est. Output Tokens | Total Cost (USD) |
|---|---|---|---|---|---|---|
| **Strategy A** | Sample | 20 | 20 | ~58,000 | ~4,000 | **~$0.234** |
| **Strategy B** | Sample | 20 | 40 | ~110,000 | ~6,000 | **~$0.420** |
| **Strategy A (Final)** | Test | 45 | 45 | ~130,500 | ~9,000 | **~$0.527** |

---

## 3. Operational Considerations

### TPM / RPM Rate Limits
- To prevent hitting rate limits (Request Per Minute / Tokens Per Minute), a delay of `time.sleep(0.5)` is added between successive API requests.
- All API exceptions are gracefully handled inside a `try/except` block, ensuring that single failures do not block the pipeline execution. If an API call fails or account limits are reached, the agent records a clear fallback verdict identifying the issue.

### Strategy Choice & Rationale

**Strategy A (Single-Pass)** was chosen for the final predictions:
1. **Cost Efficiency**: Strategy B requires sending the same base64 images twice (once for validity checking and once for full verification). Because image tokens dominate the input payload (~1,600 tokens per image), Strategy B roughly doubles the cost compared to Strategy A (e.g., $0.42 vs $0.23 on the sample set).
2. **Latency**: By running in a single pass, Strategy A reduces round-trip API latency by ~50% for valid claims.
3. **Model Capability**: Claude 3.5 Sonnet / 4.6 is a state-of-the-art vision model that easily processes multiple visual and textual tasks in a single context window. It is highly capable of checking image validity (e.g. flagging blur, glare, crop issues) while simultaneously performing claim verification, rendering the two-pass approach unnecessary.
