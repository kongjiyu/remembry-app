//! Event Knowledge types — canonical schema for structured event extraction.

use serde::{Deserialize, Serialize};

/// Canonical knowledge item types. AI output is validated and repaired server-side;
/// unknown types are mapped to `observation` with a normalized `subtype`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeType {
    Concept,
    Insight,
    Decision,
    Question,
    Task,
    Observation,
    Reference,
}

impl KnowledgeType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "concept" => Some(KnowledgeType::Concept),
            "insight" => Some(KnowledgeType::Insight),
            "decision" => Some(KnowledgeType::Decision),
            "question" => Some(KnowledgeType::Question),
            "task" => Some(KnowledgeType::Task),
            "observation" => Some(KnowledgeType::Observation),
            "reference" => Some(KnowledgeType::Reference),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            KnowledgeType::Concept => "concept",
            KnowledgeType::Insight => "insight",
            KnowledgeType::Decision => "decision",
            KnowledgeType::Question => "question",
            KnowledgeType::Task => "task",
            KnowledgeType::Observation => "observation",
            KnowledgeType::Reference => "reference",
        }
    }
}

/// Evidence snippet supporting a knowledge item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Evidence {
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Core knowledge item fields shared by all types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItem {
    pub id: String,
    #[serde(rename = "type", alias = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "sub_type")]
    pub subtype: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<String>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Question item with status tracking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionItem {
    pub id: String,
    #[serde(rename = "type", alias = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "sub_type")]
    pub subtype: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<String>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub status: QuestionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QuestionStatus {
    Open,
    Answered,
    #[serde(rename = "partially_answered")]
    PartiallyAnswered,
}

/// Task/action item with optional assignee and due date.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<String>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "assignee")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "due_date")]
    pub due_date: Option<String>,
}

/// Concept item with canonical name and aliases for deduplication.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConceptItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentiment: Option<String>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(alias = "canonical_name")]
    pub canonical_name: String,
    pub title: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub description: String,
}

/// Sentiment analysis for the event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventSentiment {
    pub overall: String,
    #[serde(default, alias = "important_emotions")]
    pub important_emotions: Vec<String>,
}

/// Full event knowledge extraction result.
/// Stored per-language in the database.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventKnowledge {
    #[serde(alias = "schema_version")]
    pub schema_version: i32,
    #[serde(alias = "event_type")]
    pub event_type: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub concepts: Vec<ConceptItem>,
    #[serde(default, alias = "key_points")]
    pub key_points: Vec<KnowledgeItem>,
    #[serde(default, alias = "insights")]
    pub insights: Vec<KnowledgeItem>,
    #[serde(default, alias = "questions")]
    pub questions: Vec<QuestionItem>,
    #[serde(default, alias = "decisions")]
    pub decisions: Vec<KnowledgeItem>,
    #[serde(default, alias = "action_items")]
    pub action_items: Vec<TaskItem>,
    #[serde(default, alias = "observations")]
    pub observations: Vec<KnowledgeItem>,
    #[serde(default, alias = "references")]
    pub references: Vec<KnowledgeItem>,
    #[serde(default, alias = "related_topics")]
    pub related_topics: Vec<String>,
    pub sentiment: EventSentiment,
}

impl Default for EventKnowledge {
    fn default() -> Self {
        Self {
            schema_version: 1,
            event_type: "meeting".to_string(),
            title: String::new(),
            summary: String::new(),
            concepts: Vec::new(),
            key_points: Vec::new(),
            insights: Vec::new(),
            questions: Vec::new(),
            decisions: Vec::new(),
            action_items: Vec::new(),
            observations: Vec::new(),
            references: Vec::new(),
            related_topics: Vec::new(),
            sentiment: EventSentiment {
                overall: "neutral".to_string(),
                important_emotions: Vec::new(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knowledge_type_from_str_valid() {
        assert_eq!(KnowledgeType::from_str("concept"), Some(KnowledgeType::Concept));
        assert_eq!(KnowledgeType::from_str("insight"), Some(KnowledgeType::Insight));
        assert_eq!(KnowledgeType::from_str("decision"), Some(KnowledgeType::Decision));
        assert_eq!(KnowledgeType::from_str("question"), Some(KnowledgeType::Question));
        assert_eq!(KnowledgeType::from_str("task"), Some(KnowledgeType::Task));
        assert_eq!(KnowledgeType::from_str("observation"), Some(KnowledgeType::Observation));
        assert_eq!(KnowledgeType::from_str("reference"), Some(KnowledgeType::Reference));
    }

    #[test]
    fn knowledge_type_from_str_case_insensitive() {
        assert_eq!(KnowledgeType::from_str("CONCEPT"), Some(KnowledgeType::Concept));
        assert_eq!(KnowledgeType::from_str("Insight"), Some(KnowledgeType::Insight));
        assert_eq!(KnowledgeType::from_str("DECISION"), Some(KnowledgeType::Decision));
    }

    #[test]
    fn knowledge_type_from_str_unknown() {
        assert_eq!(KnowledgeType::from_str("unknown"), None);
        assert_eq!(KnowledgeType::from_str("note"), None);
        assert_eq!(KnowledgeType::from_str(""), None);
    }

    #[test]
    fn knowledge_type_as_str() {
        assert_eq!(KnowledgeType::Concept.as_str(), "concept");
        assert_eq!(KnowledgeType::Insight.as_str(), "insight");
        assert_eq!(KnowledgeType::Decision.as_str(), "decision");
    }

    #[test]
    fn event_knowledge_default() {
        let ek = EventKnowledge::default();
        assert_eq!(ek.schema_version, 1);
        assert_eq!(ek.event_type, "meeting");
        assert!(ek.concepts.is_empty());
        assert_eq!(ek.sentiment.overall, "neutral");
    }

    #[test]
    fn event_knowledge_serialization() {
        let ek = EventKnowledge {
            schema_version: 1,
            event_type: "meeting".to_string(),
            title: "Test Meeting".to_string(),
            summary: "A test meeting summary".to_string(),
            concepts: vec![ConceptItem {
                id: "concept_test".to_string(),
                item_type: "concept".to_string(),
                subtype: None,
                content: "Test concept content".to_string(),
                confidence: Some(0.9),
                sentiment: None,
                evidence: vec![Evidence {
                    snippet: "Relevant quote".to_string(),
                    speaker: Some("Alice".to_string()),
                    timestamp: None,
                }],
                tags: vec!["test".to_string()],
                canonical_name: "test_concept".to_string(),
                title: "Test Concept".to_string(),
                aliases: vec!["tc".to_string()],
                description: "A test concept".to_string(),
            }],
            key_points: vec![],
            insights: vec![],
            questions: vec![],
            decisions: vec![],
            action_items: vec![],
            observations: vec![],
            references: vec![],
            related_topics: vec!["topic1".to_string()],
            sentiment: EventSentiment {
                overall: "positive".to_string(),
                important_emotions: vec!["satisfaction".to_string()],
            },
        };

        let json = serde_json::to_string(&ek).unwrap();
        let parsed: EventKnowledge = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.schema_version, 1);
        assert_eq!(parsed.concepts.len(), 1);
        assert_eq!(parsed.concepts[0].canonical_name, "test_concept");
        assert_eq!(parsed.concepts[0].aliases, vec!["tc"]);
    }

    #[test]
    fn event_knowledge_parses_snake_case_gemini_json() {
        // Gemini prompt outputs snake_case field names; structs use camelCase serde.
        // Verify full parsing round-trip matches expected camelCase output.
        let snake_json = r#"{
          "schema_version": 1,
          "event_type": "meeting",
          "title": "Sprint Planning",
          "summary": "Discussed Q2 roadmap priorities",
          "concepts": [
            {
              "id": "concept_rag",
              "type": "concept",
              "content": "RAG system for document retrieval",
              "canonical_name": "rag_system",
              "title": "RAG System",
              "aliases": ["retrieval augmented generation"],
              "description": "Retrieval-augmented generation architecture"
            }
          ],
          "key_points": [
            {
              "id": "kp_1",
              "type": "observation",
              "subtype": "priority",
              "content": "Performance is top priority this quarter",
              "confidence": 0.9,
              "evidence": [{"snippet": "We need to focus on perf", "speaker": "Alice"}],
              "tags": ["performance"]
            }
          ],
          "insights": [
            {
              "id": "insight_1",
              "type": "insight",
              "content": "Vector embeddings improve recall",
              "confidence": 0.85,
              "evidence": [{"snippet": "Embedding-based search works better"}],
              "tags": ["embeddings"]
            }
          ],
          "questions": [
            {
              "id": "q_1",
              "type": "question",
              "content": "What is the deadline for v2?",
              "status": "open",
              "evidence": [{"snippet": "When do we need to ship?"}],
              "tags": ["timeline"]
            },
            {
              "id": "q_2",
              "type": "question",
              "content": "Should we use PG or Pinecone?",
              "status": "partially_answered",
              "evidence": [{"snippet": "We discussed both options"}],
              "tags": ["database"]
            }
          ],
          "decisions": [
            {
              "id": "d_1",
              "type": "decision",
              "content": "Use PostgreSQL for vector storage",
              "evidence": [{"snippet": "We chose pgvector", "speaker": "Bob"}],
              "tags": ["database"]
            }
          ],
          "action_items": [
            {
              "id": "task_1",
              "type": "task",
              "content": "Set up vector DB cluster",
              "assignee": "Alice",
              "due_date": "2026-06-01",
              "evidence": [{"snippet": "Alice will handle this"}],
              "tags": ["infrastructure"]
            }
          ],
          "observations": [
            {
              "id": "obs_1",
              "type": "observation",
              "subtype": "risk",
              "content": "Team has limited bandwidth",
              "evidence": [{"snippet": "Everyone is overloaded"}],
              "tags": []
            }
          ],
          "references": [
            {
              "id": "ref_1",
              "type": "reference",
              "content": "Pinecone docs: https://pinecone.io/docs",
              "evidence": [{"snippet": "See the docs for setup"}],
              "tags": ["docs"]
            }
          ],
          "related_topics": ["embeddings", "performance", "database"],
          "sentiment": {
            "overall": "positive",
            "important_emotions": ["focused", "collaborative"]
          }
        }"#;

        let ek: EventKnowledge = serde_json::from_str(snake_json).unwrap();
        assert_eq!(ek.schema_version, 1);
        assert_eq!(ek.event_type, "meeting");
        assert_eq!(ek.title, "Sprint Planning");
        assert_eq!(ek.concepts.len(), 1);
        assert_eq!(ek.concepts[0].canonical_name, "rag_system");
        assert_eq!(ek.concepts[0].aliases, vec!["retrieval augmented generation"]);

        // key_points is camelCase in struct but snake_case in JSON
        assert_eq!(ek.key_points.len(), 1);
        assert_eq!(ek.key_points[0].item_type, "observation");

        // insights
        assert_eq!(ek.insights.len(), 1);
        assert_eq!(ek.insights[0].id, "insight_1");

        // questions — partially_answered status
        assert_eq!(ek.questions.len(), 2);
        let open_q = ek.questions.iter().find(|q| q.id == "q_1").unwrap();
        assert!(matches!(open_q.status, QuestionStatus::Open));
        let partial_q = ek.questions.iter().find(|q| q.id == "q_2").unwrap();
        assert!(matches!(partial_q.status, QuestionStatus::PartiallyAnswered));

        // decisions
        assert_eq!(ek.decisions.len(), 1);
        assert_eq!(ek.decisions[0].item_type, "decision");

        // action_items
        assert_eq!(ek.action_items.len(), 1);
        assert_eq!(ek.action_items[0].assignee, Some("Alice".to_string()));
        assert_eq!(ek.action_items[0].due_date, Some("2026-06-01".to_string()));

        // observations
        assert_eq!(ek.observations.len(), 1);
        assert_eq!(ek.observations[0].subtype, Some("risk".to_string()));

        // references
        assert_eq!(ek.references.len(), 1);

        // sentiment
        assert_eq!(ek.sentiment.overall, "positive");
        assert_eq!(ek.sentiment.important_emotions, vec!["focused", "collaborative"]);
    }

    #[test]
    fn question_status_partially_answered_serde() {
        // Verify QuestionStatus::PartiallyAnswered serializes as "partially_answered"
        // and deserializes from "partially_answered" string.
        let json = r#"{"status": "partially_answered"}"#;
        #[derive(Debug, serde::Deserialize)]
        struct Wrapper { status: QuestionStatus }
        let w: Wrapper = serde_json::from_str(json).unwrap();
        assert!(matches!(w.status, QuestionStatus::PartiallyAnswered));

        // Round-trip
        let ser = serde_json::to_string(&w.status).unwrap();
        assert_eq!(ser, "\"partially_answered\"");
    }

    #[test]
    fn event_knowledge_missing_ids_repaired_by_validation() {
        // When items come from Gemini with empty IDs, the repair pipeline
        // should assign stable IDs via derive_stable_id. This test verifies
        // the round-trip through repair.
        let json = r#"{
          "schema_version": 1,
          "event_type": "meeting",
          "title": "Test",
          "summary": "Test summary",
          "concepts": [
            {
              "id": "",
              "type": "concept",
              "content": "Important concept mentioned",
              "canonical_name": "important_concept",
              "title": "Important Concept",
              "aliases": [],
              "description": "An important concept"
            }
          ],
          "key_points": [
            {
              "id": "",
              "type": "observation",
              "content": "Key point without ID",
              "evidence": [{"snippet": "Quote"}],
              "tags": []
            }
          ],
          "questions": [
            {
              "id": "",
              "type": "question",
              "content": "Question without ID",
              "status": "open",
              "evidence": [{"snippet": "Quote"}],
              "tags": []
            }
          ],
          "decisions": [],
          "action_items": [],
          "observations": [],
          "references": [],
          "related_topics": [],
          "sentiment": {"overall": "neutral", "important_emotions": []}
        }"#;

        let ek: EventKnowledge = serde_json::from_str(json).unwrap();
        assert_eq!(ek.concepts[0].id, "");
        assert_eq!(ek.key_points[0].id, "");
        assert_eq!(ek.questions[0].id, "");

        // The repair function should assign IDs when called
        use crate::gemini::validation;
        let repaired = validation::repair_event_knowledge(ek);

        // After repair, empty IDs should be replaced with stable IDs
        assert!(!repaired.concepts[0].id.is_empty(), "concept ID should be repaired");
        assert!(!repaired.key_points[0].id.is_empty(), "key_point ID should be repaired");
        assert!(!repaired.questions[0].id.is_empty(), "question ID should be repaired");

        // Concept ID should start with "concept_"
        assert!(repaired.concepts[0].id.starts_with("concept_"));
    }
}