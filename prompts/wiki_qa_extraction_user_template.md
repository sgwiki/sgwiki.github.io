# Task
아래 게시글 배열을 각각 독립적으로 정제하라.

# Requirements
- 출력 배열의 길이와 순서는 입력 배열과 동일해야 한다.
- 댓글 번호는 입력 `comments` 배열 기준으로 0부터 시작한다.
- `source_url`에는 입력의 `url`을 그대로 넣는다.
- `title_clean`은 제목의 의미를 바꾸지 말고 불필요한 공백만 정리한다.
- `question_intent`는 사용자가 무엇을 알고 싶어 하는지 한 문장으로 쓴다.
- `answer_candidate.summary`는 댓글 근거를 압축한 답변 후보이며, 근거가 약하면 그 약점을 드러낸다.
- `concept_id`는 가능하면 Concept Catalog의 id를 사용한다.
- 새 문서 후보가 필요하면 간결한 snake_case `concept_id`를 새로 만든다.
- JSON 외 텍스트를 출력하지 않는다.
- JSON을 문자열로 감싸거나 따옴표를 `\"`로 이스케이프하지 않는다.
