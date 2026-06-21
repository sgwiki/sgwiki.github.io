from pathlib import Path

from rdflib import OWL, RDF, RDFS, Graph, Literal, URIRef
from rdflib.term import Node

_BASE = Path(__file__).parent.parent
TTL_PATH = _BASE / "슈타인즈게이트_온톨로지.ttl"
CLASS_DOCS_PATH = _BASE / "슈타인즈게이트_온톨로지_클래스_해설.md"

PREFIXES = """\
PREFIX sg: <http://example.org/steinsgate#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
"""

_SCHEMA_TYPES = {
    OWL.Class,
    OWL.ObjectProperty,
    OWL.DatatypeProperty,
    OWL.AnnotationProperty,
    OWL.Ontology,
    RDFS.Class,
}


def _node_to_value(node: Node) -> object:
    if isinstance(node, Literal):
        try:
            return node.toPython()
        except Exception:
            return str(node)
    if isinstance(node, URIRef):
        s = str(node)
        return s.split("#")[-1] if "#" in s else s
    return str(node)


class SteinsGateOntology:
    def __init__(self, ttl_path: Path = TTL_PATH) -> None:
        self._g = Graph()
        self._g.parse(str(ttl_path), format="turtle")

    def query(self, sparql: str) -> list[dict]:
        try:
            full = PREFIXES + "\n" + sparql if not sparql.strip().startswith("PREFIX") else sparql
            results = self._g.query(full)
            return [
                {str(var): _node_to_value(row[var]) for var in results.vars if row[var] is not None}
                for row in results
            ]
        except Exception as exc:
            return [{"error": str(exc)}]

    def schema_ttl(self) -> str:
        sg = Graph()
        for prefix, ns in self._g.namespaces():
            sg.bind(prefix, ns)
        schema_subjects: set[Node] = set()
        for s, p, o in self._g:
            if p == RDF.type and o in _SCHEMA_TYPES:
                schema_subjects.add(s)
        for s, p, o in self._g:
            if s in schema_subjects:
                sg.add((s, p, o))
        return sg.serialize(format="turtle")

