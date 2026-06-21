"""슈타인즈게이트 온톨로지 MCP 서버."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from amadeus.ontology import CLASS_DOCS_PATH, SteinsGateOntology

_ontology = SteinsGateOntology()
app = FastMCP("steinsgate-ontology")

SG_NS = "http://example.org/steinsgate#"


def _sg_uri(event_id: str) -> str:
    if event_id.startswith("sg:"):
        return f"<{SG_NS}{event_id[3:]}>"
    if event_id.startswith(SG_NS) or event_id.startswith("<"):
        return event_id if event_id.startswith("<") else f"<{event_id}>"
    return f"<{SG_NS}{event_id}>"


# ─── Tools ──────────────────────────────────────────────────────────────────

@app.tool()
def sparql_query(query: str) -> list[dict]:
    """임의의 SPARQL SELECT 쿼리를 온톨로지에 실행합니다.
    PREFIX sg/rdf/rdfs/owl/xsd 는 자동 주입되므로 생략 가능합니다.

    주요 인스턴스 predicate:
    - sg:id, sg:labelKo, sg:summary, sg:description, sg:note
    - sg:eventType, sg:mechanismType, sg:localDateTime, sg:place
    - sg:actor, sg:target, sg:divergenceValue, sg:isActive
    - sg:belongsToAttractorField, sg:partOfVariation, sg:partOfMacroEvent
    - sg:causes, sg:enables, sg:prevents, sg:participatesInShift
    - sg:triggeredByEvent, sg:fromWorldLine, sg:toWorldLine
    - sg:answerLabel, sg:timeWindow, sg:appliesToCharacter
    인스턴스 label은 sg:labelKo 사용 (rdfs:label 아님).
    """
    return _ontology.query(query)


@app.tool()
def list_worldlines() -> list[dict]:
    """전체 WorldLine 목록을 반환합니다 (다이버전스 수치, 활성 여부, 소속 어트랙터 필드 포함)."""
    return _ontology.query("""
        SELECT ?id ?labelKo ?divergenceValue ?isActive ?af WHERE {
          ?wl a sg:WorldLine ;
              sg:id ?id ;
              sg:labelKo ?labelKo ;
              sg:divergenceValue ?divergenceValue ;
              sg:isActive ?isActive ;
              sg:belongsToAttractorField ?af .
        }
        ORDER BY ?divergenceValue
    """)


@app.tool()
def list_attractor_fields() -> list[dict]:
    """전체 AttractorField(어트랙터 필드) 목록을 반환합니다."""
    return _ontology.query("""
        SELECT ?id ?labelKo ?description WHERE {
          ?af a sg:AttractorField ;
              sg:id ?id ;
              sg:labelKo ?labelKo .
          OPTIONAL { ?af sg:description ?description }
        }
    """)


@app.tool()
def list_macro_events() -> list[dict]:
    """전체 MacroEvent(거시 사건) 목록과 서사 설명을 반환합니다."""
    return _ontology.query("""
        SELECT ?id ?labelKo ?note WHERE {
          ?me a sg:MacroEvent ;
              sg:id ?id ;
              sg:labelKo ?labelKo .
          OPTIONAL { ?me sg:note ?note }
        }
    """)


@app.tool()
def list_event_variations(macro_event_id: str = "") -> list[dict]:
    """EventVariation(사건 변형) 목록을 반환합니다.
    macro_event_id 를 지정하면 해당 거시 사건에 속한 변형만 반환합니다 (예: ME_MayuriRescue_Loop).
    """
    rows = _ontology.query("""
        SELECT ?id ?variationIdentity ?branchCondition ?wl ?me WHERE {
          ?ev a sg:EventVariation ;
              sg:id ?id ;
              sg:variationIdentity ?variationIdentity ;
              sg:branchCondition ?branchCondition ;
              sg:belongsToWorldLine ?wl ;
              sg:partOfMacroEvent ?me .
        }
        ORDER BY ?me ?id
    """)
    if macro_event_id:
        key = macro_event_id.replace("sg:", "")
        rows = [r for r in rows if r.get("me") == key or r.get("me") == macro_event_id]
    return rows


@app.tool()
def get_events(variation_id: str = "", attractor_field: str = "") -> list[dict]:
    """Event(원자 사건) 목록과 전체 속성을 반환합니다.
    variation_id: 해당 변형에 속한 사건만 (예: EV_Skuld_Success)
    attractor_field: 해당 AF 소속 세계선 이벤트만 (예: AF_Alpha)
    """
    af_key = attractor_field.replace("sg:", "") if attractor_field else ""
    af_filter = f"""
          ?e sg:partOfVariation ?ev2 .
          ?ev2 sg:belongsToWorldLine ?wl2 .
          ?wl2 sg:belongsToAttractorField sg:{af_key} .
    """ if af_key else ""
    rows = _ontology.query(f"""
        SELECT ?id ?labelKo ?summary ?eventType ?mechanismType
               ?localDateTime ?timePrecision ?place ?actor ?target ?ev WHERE {{
          ?e a sg:Event ;
             sg:id ?id ;
             sg:labelKo ?labelKo ;
             sg:summary ?summary ;
             sg:eventType ?eventType ;
             sg:mechanismType ?mechanismType ;
             sg:localDateTime ?localDateTime ;
             sg:timePrecision ?timePrecision ;
             sg:place ?place ;
             sg:partOfVariation ?ev .
          OPTIONAL {{ ?e sg:actor ?actor }}
          OPTIONAL {{ ?e sg:target ?target }}
          {af_filter}
        }}
        ORDER BY ?localDateTime
    """)
    if variation_id:
        key = variation_id.replace("sg:", "")
        rows = [r for r in rows if r.get("ev") == key or r.get("ev") == variation_id]
    return rows


@app.tool()
def get_worldline_shifts() -> list[dict]:
    """WorldLineShift(세계선 이동) 전체 기록을 반환합니다 (출발·도착 세계선, 유발 사건 포함)."""
    return _ontology.query("""
        SELECT ?id ?shiftType ?shiftMoment ?summary ?fromWL ?toWL ?trigger WHERE {
          ?shift a sg:WorldLineShift ;
                 sg:id ?id ;
                 sg:shiftType ?shiftType ;
                 sg:shiftMoment ?shiftMoment ;
                 sg:summary ?summary ;
                 sg:fromWorldLine ?fromWL ;
                 sg:toWorldLine ?toWL ;
                 sg:triggeredByEvent ?trigger .
        }
        ORDER BY ?shiftMoment
    """)


@app.tool()
def get_convergence_patterns() -> list[dict]:
    """ConvergencePattern(수렴 패턴) 목록과 연결된 EventVariation id 목록을 반환합니다."""
    patterns = _ontology.query("""
        SELECT ?id ?labelKo ?description ?timeWindow ?appliesToCharacter WHERE {
          ?cp a sg:ConvergencePattern ;
              sg:id ?id ;
              sg:labelKo ?labelKo ;
              sg:description ?description ;
              sg:timeWindow ?timeWindow .
          OPTIONAL { ?cp sg:appliesToCharacter ?appliesToCharacter }
        }
    """)
    variations = _ontology.query("""
        SELECT ?cpId ?evId WHERE {
          ?cp a sg:ConvergencePattern ;
              sg:id ?cpId ;
              sg:hasVariantVariation ?ev .
          ?ev sg:id ?evId .
        }
    """)
    ev_map: dict[str, list[str]] = {}
    for v in variations:
        ev_map.setdefault(v["cpId"], []).append(v["evId"])
    for p in patterns:
        p["variantVariations"] = ev_map.get(p["id"], [])
    return patterns


@app.tool()
def get_science_topics() -> list[dict]:
    """ScienceTopic(과학 해설 주제) 목록을 반환합니다 (answerLabel, summary, 해설 대상 포함)."""
    topics = _ontology.query("""
        SELECT ?id ?labelKo ?answerLabel ?summary WHERE {
          ?t a sg:ScienceTopic ;
             sg:id ?id ;
             sg:labelKo ?labelKo ;
             sg:answerLabel ?answerLabel ;
             sg:summary ?summary .
        }
    """)
    entities = _ontology.query("""
        SELECT ?topicId ?entity WHERE {
          ?t a sg:ScienceTopic ;
             sg:id ?topicId ;
             sg:explainsEntity ?entity .
        }
    """)
    ent_map: dict[str, list[str]] = {}
    for e in entities:
        ent_map.setdefault(e["topicId"], []).append(e["entity"])
    for t in topics:
        t["explainsEntities"] = ent_map.get(t["id"], [])
    return topics


@app.tool()
def get_causal_chain(event_id: str) -> list[dict]:
    """특정 Event의 인과 관계(causes/enables/prevents/participatesInShift)를
    아웃바운드·인바운드 양방향으로 반환합니다.
    event_id 예시: 'sg:Event_FirstDMail' 또는 'Event_FirstDMail'
    """
    uri = _sg_uri(event_id)
    return _ontology.query(f"""
        SELECT ?relation ?otherId ?otherLabel WHERE {{
          {{
            {uri} sg:causes ?other .
            BIND("causes" AS ?relation)
          }} UNION {{
            {uri} sg:enables ?other .
            BIND("enables" AS ?relation)
          }} UNION {{
            {uri} sg:prevents ?other .
            BIND("prevents" AS ?relation)
          }} UNION {{
            {uri} sg:participatesInShift ?other .
            BIND("participatesInShift" AS ?relation)
          }} UNION {{
            ?other sg:causes {uri} .
            BIND("causedBy" AS ?relation)
          }} UNION {{
            ?other sg:enables {uri} .
            BIND("enabledBy" AS ?relation)
          }} UNION {{
            ?other sg:prevents {uri} .
            BIND("preventedBy" AS ?relation)
          }} UNION {{
            ?other sg:triggeredByEvent {uri} .
            BIND("triggersShift" AS ?relation)
            BIND(?other AS ?other)
          }}
          OPTIONAL {{ ?other sg:id ?otherId }}
          OPTIONAL {{ ?other sg:labelKo ?otherLabel }}
        }}
        LIMIT 50
    """)


@app.tool()
def search_by_label(keyword: str) -> list[dict]:
    """keyword 로 labelKo, summary, description, note, target, actor 필드에서
    대소문자 무관 검색합니다. 한국어·영문 모두 지원합니다.
    """
    safe = keyword.replace("\\", "\\\\").replace('"', '\\"')
    return _ontology.query(f"""
        SELECT DISTINCT ?type ?id ?labelKo ?summary WHERE {{
          ?s ?p ?text .
          ?s rdf:type ?type .
          FILTER(?p IN (sg:labelKo, sg:summary, sg:description,
                        sg:note, sg:target, sg:actor,
                        sg:variationIdentity, sg:branchCondition))
          FILTER(CONTAINS(LCASE(STR(?text)), LCASE("{safe}")))
          OPTIONAL {{ ?s sg:id ?id }}
          OPTIONAL {{ ?s sg:labelKo ?labelKo }}
          OPTIONAL {{ ?s sg:summary ?summary }}
        }}
        LIMIT 30
    """)


# ─── Resources ──────────────────────────────────────────────────────────────

@app.resource(
    "steinsgate://class-docs",
    name="class-docs",
    description="슈타인즈게이트 온톨로지 클래스 해설 문서 (전체 Markdown)",
    mime_type="text/markdown",
)
def class_docs() -> str:
    return CLASS_DOCS_PATH.read_text(encoding="utf-8")


@app.resource(
    "steinsgate://ontology-schema",
    name="ontology-schema",
    description="온톨로지 클래스·속성 정의만 추출한 Turtle (인스턴스 제외)",
    mime_type="text/turtle",
)
def ontology_schema() -> str:
    return _ontology.schema_ttl()


# ─── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    app.run()


if __name__ == "__main__":
    main()
