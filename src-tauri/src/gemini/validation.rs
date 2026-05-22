//! EventKnowledge validation and repair pipeline.
//!
//! AI output is validated and repaired server-side:
//! - Unknown `KnowledgeType` values are mapped to `observation` with a normalized `subtype`
//! - Stable IDs are derived from canonical fields or deterministically hashed
//! - Evidence arrays are enforced for high-accuracy items
//! - Duplicate IDs are deduplicated

use crate::db::events::{
    ConceptItem, Evidence, EventKnowledge, KnowledgeItem, KnowledgeType,
    QuestionItem, QuestionStatus, TaskItem,
};
use std::collections::HashMap;

/// Validate a type string against the canonical KnowledgeType enum.
/// Returns the validated type, or None if the string doesn't match any known type.
pub fn validate_knowledge_type(type_str: &str) -> Option<KnowledgeType> {
    KnowledgeType::from_str(type_str)
}

/// Repair a KnowledgeItem by normalizing its fields:
/// - Validates and fixes the type field (unknown → observation with subtype)
/// - Ensures evidence array exists (for high-accuracy items)
/// - Ensures tags array exists
/// - Assigns stable ID when id is empty
pub fn repair_knowledge_item(mut item: KnowledgeItem) -> KnowledgeItem {
    // Validate type; if unknown, map to observation with subtype
    let validated_type = validate_knowledge_type(&item.item_type)
        .map(|kt| kt.as_str().to_string())
        .unwrap_or_else(|| {
            let original = item.item_type.clone();
            item.subtype = Some(normalize_subtype(&original));
            "observation".to_string()
        });

    item.item_type = validated_type;

    // For high-accuracy items, ensure evidence is present
    if item.evidence.is_empty() && requires_evidence(&item.item_type) {
        item.evidence = vec![Evidence {
            snippet: "[No evidence provided]".to_string(),
            speaker: None,
            timestamp: None,
        }];
    }

    if item.tags.is_empty() {
        item.tags = Vec::new();
    }

    // Assign stable ID when id is empty
    if item.id.is_empty() {
        item.id = derive_stable_id(&item);
    }

    item
}

/// Check if an item type requires evidence.
fn requires_evidence(item_type: &str) -> bool {
    matches!(
        item_type,
        "decision" | "task" | "reference"
            | "requirement" | "blocker"
    )
}

/// Normalize a subtype string: lowercase, snake_case.
fn normalize_subtype(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

/// Derive a stable ID from canonical fields.
/// For concepts: `concept_{canonical_name}`
/// For others: deterministic hash of content
pub fn derive_stable_id(item: &KnowledgeItem) -> String {
    if item.item_type == "concept" {
        // Concepts have canonical_name in their structured form
        // but at this level we derive from content
        let base = item.content.split_whitespace().take(3).collect::<Vec<_>>().join("_");
        format!("concept_{}", normalize_subtype(&base))
    } else {
        // Hash-based ID for non-concept items
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        item.content.hash(&mut hasher);
        let hash = hasher.finish();
        format!("{}_{:x}", item.item_type, hash)
    }
}

/// Repair a QuestionItem.
pub fn repair_question_item(mut item: QuestionItem) -> QuestionItem {
    let validated_type = validate_knowledge_type(&item.item_type)
        .map(|kt| kt.as_str().to_string())
        .unwrap_or_else(|| {
            item.subtype = Some(normalize_subtype(&item.item_type));
            "question".to_string()
        });

    item.item_type = validated_type;

    if item.evidence.is_empty() {
        item.evidence = vec![Evidence {
            snippet: "[No evidence provided]".to_string(),
            speaker: None,
            timestamp: None,
        }];
    }

    if item.tags.is_empty() {
        item.tags = Vec::new();
    }

    // Validate status
    let valid_statuses = ["open", "answered", "partially_answered"];
    let status_str = match &item.status {
        QuestionStatus::Open => "open",
        QuestionStatus::Answered => "answered",
        QuestionStatus::PartiallyAnswered => "partially_answered",
    };
    if !valid_statuses.contains(&status_str) {
        item.status = QuestionStatus::Open;
    }

    // Assign stable ID when id is empty
    if item.id.is_empty() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        item.content.hash(&mut hasher);
        let hash = hasher.finish();
        item.id = format!("question_{:x}", hash);
    }

    item
}

/// Repair a TaskItem.
pub fn repair_task_item(mut item: TaskItem) -> TaskItem {
    let validated_type = validate_knowledge_type(&item.item_type)
        .map(|kt| kt.as_str().to_string())
        .unwrap_or_else(|| {
            item.subtype = Some(normalize_subtype(&item.item_type));
            "task".to_string()
        });

    item.item_type = validated_type;

    if item.evidence.is_empty() {
        item.evidence = vec![Evidence {
            snippet: "[No evidence provided]".to_string(),
            speaker: None,
            timestamp: None,
        }];
    }

    if item.tags.is_empty() {
        item.tags = Vec::new();
    }

    // Assign stable ID when id is empty
    if item.id.is_empty() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        item.content.hash(&mut hasher);
        let hash = hasher.finish();
        item.id = format!("task_{:x}", hash);
    }

    item
}

/// Repair a ConceptItem.
pub fn repair_concept_item(mut item: ConceptItem) -> ConceptItem {
    item.item_type = "concept".to_string();

    // Only derive canonical_name from content when it is empty
    if item.canonical_name.is_empty() {
        item.canonical_name = normalize_canonical_name(&item.content);
    }

    if item.evidence.is_empty() {
        item.evidence = vec![Evidence {
            snippet: "[No evidence provided]".to_string(),
            speaker: None,
            timestamp: None,
        }];
    }

    if item.tags.is_empty() {
        item.tags = Vec::new();
    }

    if item.aliases.is_empty() {
        item.aliases = Vec::new();
    }

    // Assign stable ID when id is empty
    if item.id.is_empty() {
        item.id = format!("concept_{}", item.canonical_name);
    }

    item
}

/// Normalize a canonical name: lowercase, snake_case.
fn normalize_canonical_name(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
}

/// Repair the full EventKnowledge structure:
/// - Validates all knowledge item types
/// - Deduplicates IDs within each array
/// - Ensures all required arrays exist
/// - Validates sentiment
pub fn repair_event_knowledge(mut ek: EventKnowledge) -> EventKnowledge {
    ek.schema_version = 1;

    // Repair concepts
    ek.concepts = dedup_concepts(ek.concepts.into_iter().map(repair_concept_item).collect());

    // Repair key_points
    ek.key_points = dedup_items(ek.key_points.into_iter().map(repair_knowledge_item).collect());

    // Repair insights
    ek.insights = dedup_items(ek.insights.into_iter().map(repair_knowledge_item).collect());

    // Repair questions
    ek.questions = dedup_questions(ek.questions.into_iter().map(repair_question_item).collect());

    // Repair decisions
    ek.decisions = dedup_items(ek.decisions.into_iter().map(repair_knowledge_item).collect());

    // Repair action_items (tasks)
    ek.action_items = dedup_tasks(ek.action_items.into_iter().map(repair_task_item).collect());

    // Repair observations
    ek.observations = dedup_items(ek.observations.into_iter().map(repair_knowledge_item).collect());

    // Repair references
    ek.references = dedup_items(ek.references.into_iter().map(repair_knowledge_item).collect());

    // Validate sentiment
    let valid_sentiments = ["positive", "neutral", "negative", "mixed"];
    if !valid_sentiments.contains(&ek.sentiment.overall.as_str()) {
        ek.sentiment.overall = "neutral".to_string();
    }

    // Ensure arrays are not null
    if ek.related_topics.is_empty() {
        ek.related_topics = Vec::new();
    }

    ek
}

/// Deduplicate concept items by canonical_name.
fn dedup_concepts(mut items: Vec<ConceptItem>) -> Vec<ConceptItem> {
    let mut seen = HashMap::new();
    items.retain(|item| {
        let key = item.canonical_name.clone();
        if seen.contains_key(&key) {
            false
        } else {
            seen.insert(key, true);
            true
        }
    });
    items
}

/// Deduplicate knowledge items by ID.
fn dedup_items(mut items: Vec<KnowledgeItem>) -> Vec<KnowledgeItem> {
    let mut seen = HashMap::new();
    items.retain(|item| {
        if item.id.is_empty() {
            true // Keep items with empty IDs (repair will assign new IDs later)
        } else if seen.contains_key(&item.id) {
            false
        } else {
            seen.insert(item.id.clone(), true);
            true
        }
    });
    items
}

/// Deduplicate question items by ID.
fn dedup_questions(mut items: Vec<QuestionItem>) -> Vec<QuestionItem> {
    let mut seen = HashMap::new();
    items.retain(|item| {
        if item.id.is_empty() {
            true
        } else if seen.contains_key(&item.id) {
            false
        } else {
            seen.insert(item.id.clone(), true);
            true
        }
    });
    items
}

/// Deduplicate task items by ID.
fn dedup_tasks(mut items: Vec<TaskItem>) -> Vec<TaskItem> {
    let mut seen = HashMap::new();
    items.retain(|item| {
        if item.id.is_empty() {
            true
        } else if seen.contains_key(&item.id) {
            false
        } else {
            seen.insert(item.id.clone(), true);
            true
        }
    });
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::events::EventSentiment;

    #[test]
    fn validate_knowledge_type_valid() {
        assert_eq!(validate_knowledge_type("concept"), Some(KnowledgeType::Concept));
        assert_eq!(validate_knowledge_type("insight"), Some(KnowledgeType::Insight));
        assert_eq!(validate_knowledge_type("decision"), Some(KnowledgeType::Decision));
        assert_eq!(validate_knowledge_type("question"), Some(KnowledgeType::Question));
        assert_eq!(validate_knowledge_type("task"), Some(KnowledgeType::Task));
        assert_eq!(validate_knowledge_type("observation"), Some(KnowledgeType::Observation));
        assert_eq!(validate_knowledge_type("reference"), Some(KnowledgeType::Reference));
    }

    #[test]
    fn validate_knowledge_type_case_insensitive() {
        assert_eq!(validate_knowledge_type("CONCEPT"), Some(KnowledgeType::Concept));
        assert_eq!(validate_knowledge_type("Insight"), Some(KnowledgeType::Insight));
    }

    #[test]
    fn validate_knowledge_type_unknown() {
        assert_eq!(validate_knowledge_type("unknown"), None);
        assert_eq!(validate_knowledge_type("note"), None);
    }

    #[test]
    fn repair_knowledge_item_unknown_type() {
        let item = KnowledgeItem {
            id: "test".to_string(),
            item_type: "unknown_type".to_string(),
            subtype: None,
            content: "Test content".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
        };

        let repaired = repair_knowledge_item(item.clone());
        assert_eq!(repaired.item_type, "observation");
        assert_eq!(repaired.subtype, Some("unknown_type".to_string()));
    }

    #[test]
    fn repair_knowledge_item_preserves_valid_type() {
        let item = KnowledgeItem {
            id: "test".to_string(),
            item_type: "concept".to_string(),
            subtype: None,
            content: "Test content".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
        };

        let repaired = repair_knowledge_item(item);
        assert_eq!(repaired.item_type, "concept");
        assert!(repaired.subtype.is_none());
    }

    #[test]
    fn repair_knowledge_item_adds_evidence_for_decision() {
        let item = KnowledgeItem {
            id: "decision1".to_string(),
            item_type: "decision".to_string(),
            subtype: None,
            content: "We decided to go with option A".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
        };

        let repaired = repair_knowledge_item(item);
        assert!(!repaired.evidence.is_empty());
        assert_eq!(repaired.evidence[0].snippet, "[No evidence provided]");
    }

    #[test]
    fn derive_stable_id_concept() {
        let item = KnowledgeItem {
            id: "".to_string(),
            item_type: "concept".to_string(),
            subtype: None,
            content: "RAG retrieval augmented generation".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
        };

        let id = derive_stable_id(&item);
        assert!(id.starts_with("concept_"));
    }

    #[test]
    fn derive_stable_id_non_concept() {
        let item = KnowledgeItem {
            id: "".to_string(),
            item_type: "decision".to_string(),
            subtype: None,
            content: "We decided to ship on Friday".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
        };

        let id = derive_stable_id(&item);
        assert!(id.starts_with("decision_"));
    }

    #[test]
    fn normalize_subtype_special_chars() {
        assert_eq!(normalize_subtype("Player Feedback"), "player_feedback");
        assert_eq!(normalize_subtype("frustration"), "frustration");
        assert_eq!(normalize_subtype("feature-request"), "feature_request");
    }

    #[test]
    fn repair_event_knowledge_deduplicates_concepts() {
        let ek = EventKnowledge {
            schema_version: 1,
            event_type: "meeting".to_string(),
            title: "Test".to_string(),
            summary: "Test summary".to_string(),
            concepts: vec![
                ConceptItem {
                    id: "c1".to_string(),
                    item_type: "concept".to_string(),
                    subtype: None,
                    content: "RAG".to_string(),
                    confidence: None,
                    sentiment: None,
                    evidence: vec![],
                    tags: vec![],
                    canonical_name: "rag".to_string(),
                    title: "RAG".to_string(),
                    aliases: vec!["Retrieval-Augmented Generation".to_string()],
                    description: "RAG description".to_string(),
                },
                ConceptItem {
                    id: "c2".to_string(),
                    item_type: "concept".to_string(),
                    subtype: None,
                    content: "RAG".to_string(), // same content → same canonical_name after repair
                    confidence: None,
                    sentiment: None,
                    evidence: vec![],
                    tags: vec![],
                    canonical_name: "rag".to_string(), // duplicate
                    title: "RAG".to_string(),
                    aliases: vec![],
                    description: "Another RAG".to_string(),
                },
            ],
            key_points: vec![],
            insights: vec![],
            questions: vec![],
            decisions: vec![],
            action_items: vec![],
            observations: vec![],
            references: vec![],
            related_topics: vec![],
            sentiment: EventSentiment {
                overall: "neutral".to_string(),
                important_emotions: vec![],
            },
        };

        let repaired = repair_event_knowledge(ek);
        assert_eq!(repaired.concepts.len(), 1);
        assert_eq!(repaired.concepts[0].canonical_name, "rag");
    }

    #[test]
    fn repair_event_knowledge_invalid_sentiment() {
        let ek = EventKnowledge {
            schema_version: 1,
            event_type: "meeting".to_string(),
            title: "Test".to_string(),
            summary: "Test summary".to_string(),
            concepts: vec![],
            key_points: vec![],
            insights: vec![],
            questions: vec![],
            decisions: vec![],
            action_items: vec![],
            observations: vec![],
            references: vec![],
            related_topics: vec![],
            sentiment: EventSentiment {
                overall: "unknown_sentiment".to_string(),
                important_emotions: vec![],
            },
        };

        let repaired = repair_event_knowledge(ek);
        assert_eq!(repaired.sentiment.overall, "neutral");
    }

    #[test]
    fn repair_task_item_assigns_id_when_empty() {
        let item = TaskItem {
            id: "".to_string(),
            item_type: "task".to_string(),
            subtype: None,
            content: "Review the PR for the auth module".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
            assignee: Some("Alice".to_string()),
            due_date: None,
        };

        let repaired = repair_task_item(item);
        assert!(!repaired.id.is_empty(), "ID should be assigned");
        assert!(repaired.id.starts_with("task_"), "ID should start with task_");
    }

    #[test]
    fn repair_task_item_preserves_existing_id() {
        let item = TaskItem {
            id: "task_existing_123".to_string(),
            item_type: "task".to_string(),
            subtype: None,
            content: "Review the PR for the auth module".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
            assignee: Some("Alice".to_string()),
            due_date: None,
        };

        let repaired = repair_task_item(item);
        assert_eq!(repaired.id, "task_existing_123");
    }

    #[test]
    fn repair_concept_item_preserves_provided_canonical_name() {
        let item = ConceptItem {
            id: "c1".to_string(),
            item_type: "concept".to_string(),
            subtype: None,
            content: "RAG retrieval augmented generation".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
            canonical_name: "rag_system".to_string(),
            title: "RAG".to_string(),
            aliases: vec![],
            description: "RAG description".to_string(),
        };

        let repaired = repair_concept_item(item);
        assert_eq!(repaired.canonical_name, "rag_system", "Provided canonical_name should be preserved");
    }

    #[test]
    fn repair_concept_item_derives_canonical_name_when_empty() {
        let item = ConceptItem {
            id: "c1".to_string(),
            item_type: "concept".to_string(),
            subtype: None,
            content: "RAG retrieval augmented generation".to_string(),
            confidence: None,
            sentiment: None,
            evidence: vec![],
            tags: vec![],
            canonical_name: "".to_string(),
            title: "RAG".to_string(),
            aliases: vec![],
            description: "RAG description".to_string(),
        };

        let repaired = repair_concept_item(item);
        assert!(!repaired.canonical_name.is_empty(), "canonical_name should be derived from content");
        assert_eq!(repaired.canonical_name, "rag_retrieval_augmented_generation");
    }
}