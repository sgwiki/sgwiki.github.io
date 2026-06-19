export interface Env {
  SUGGESTIONS: R2Bucket;
}

interface Decision {
  id: string;
  type: "A" | "B";
  verdict: "approved" | "rejected" | "partial";
  feedback: string;
  link: string | null;
}

interface PublicDecision {
  id: string;
  type: string;
  verdict: string;
  feedback: string;
  link: string | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

    const list = await env.SUGGESTIONS.list({
      prefix: "suggestions/decisions/",
      cursor,
      limit,
    });

    const decisions: PublicDecision[] = (
      await Promise.all(
        list.objects.map(async (obj) => {
          const r = await env.SUGGESTIONS.get(obj.key);
          if (!r) return null;
          const data = await r.json<Decision>();
          // 공개 히스토리: feedback + link만 노출. 내부 판정 근거 미노출.
          return {
            id: data.id,
            type: data.type,
            verdict: data.verdict,
            feedback: data.feedback,
            link: data.link ?? null,
          };
        })
      )
    ).filter((d): d is PublicDecision => d !== null);

    return new Response(
      JSON.stringify({
        decisions,
        cursor: list.truncated ? list.cursor : null,
        total: decisions.length,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "https://sg-wiki.pages.dev",
        },
      }
    );
  },
};
