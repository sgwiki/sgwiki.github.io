curl http://localhost:8000/v1/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "leon-se/gemma-4-E4B-it-FP8-Dynamic",
        "prompt": "<start_of_turn>user\n슈타인즈 게이트에 대해 설명해.<end_of_turn>\n<start_of_turn>model\n",
        "max_tokens": 100,
        "temperature": 0.8
    }'