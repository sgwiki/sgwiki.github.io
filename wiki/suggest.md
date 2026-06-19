# 제안하기

오탈자, 설정 오류, 누락된 내용, 또는 추가됐으면 하는 문서 주제를 자유롭게 제안해 주세요.

제안은 위키 관리팀이 검토 후 반영합니다. 연락처는 선택 사항이며, 회신이 필요한 경우에만 남겨 주세요.

---

<form id="suggest-form" style="max-width:600px">
  <div style="margin-bottom:1rem">
    <label for="content" style="display:block;margin-bottom:.4rem;font-weight:600">제안 내용 <span style="color:#e64">*</span></label>
    <textarea id="content" name="content" rows="7"
      placeholder="예: '어트랙터 필드' 문서에서 3장 2절 내용이 원작 설정과 다릅니다. …"
      style="width:100%;padding:.6rem;border:1px solid #555;border-radius:4px;background:#1e1e1e;color:#eee;font-size:.95rem;resize:vertical"></textarea>
  </div>
  <div style="margin-bottom:1rem">
    <label for="contact" style="display:block;margin-bottom:.4rem;font-weight:600">연락처 <span style="color:#999;font-weight:400">(선택)</span></label>
    <input type="text" id="contact" name="contact"
      placeholder="이메일, 트위터 ID 등"
      style="width:100%;padding:.6rem;border:1px solid #555;border-radius:4px;background:#1e1e1e;color:#eee;font-size:.95rem">
  </div>
  <div class="h-captcha" data-sitekey="99cac9da-2ee2-4538-94fe-fc22794428ee" style="margin-bottom:1rem"></div>
  <button type="submit"
    style="padding:.6rem 1.4rem;background:#e64;border:none;border-radius:4px;color:#fff;font-size:1rem;cursor:pointer">
    제출
  </button>
  <p id="suggest-result" style="margin-top:.8rem;font-size:.95rem"></p>
</form>

<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<script>
document.getElementById('suggest-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var result = document.getElementById('suggest-result');
  var content = document.getElementById('content').value;
  var contact = document.getElementById('contact').value;
  var token = hcaptcha.getResponse();

  if (!content.trim()) {
    result.textContent = '⚠ 내용을 입력해 주세요.';
    return;
  }
  if (!token) {
    result.textContent = '⚠ 캡차를 완료해 주세요.';
    return;
  }

  result.textContent = '전송 중…';

  try {
    var res = await fetch('https://sg-wiki-suggest.flaglow72.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, content: content, contact: contact || undefined })
    });
    var data = await res.json();
    if (data.ok) {
      result.textContent = '✓ 제안이 접수되었습니다. 감사합니다!';
      document.getElementById('suggest-form').reset();
      hcaptcha.reset();
    } else {
      var msg = { rate_limit_exceeded: '시간당 제출 횟수(5회)를 초과했습니다.', captcha_failed: '캡차 인증에 실패했습니다.', content_too_long: '내용이 너무 깁니다 (최대 2000자).' };
      result.textContent = '✗ ' + (msg[data.error] || '오류가 발생했습니다: ' + data.error);
    }
  } catch (err) {
    result.textContent = '✗ 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
});
</script>
