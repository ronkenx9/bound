module ledger::record {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;

    // 0 = payment_in | 1 = payment_out | 2 = instruction | 3 = evidence
    const RECORD_TYPE_PAYMENT_IN:  u8 = 0;
    const RECORD_TYPE_PAYMENT_OUT: u8 = 1;
    const RECORD_TYPE_INSTRUCTION: u8 = 2;
    const RECORD_TYPE_EVIDENCE:    u8 = 3;

    // 0 = human | 1 = agent
    const ACTOR_TYPE_HUMAN: u8 = 0;
    const ACTOR_TYPE_AGENT: u8 = 1;

    // 0 = none | 1 = approved | 2 = rejected | 3 = executed | 4 = failed
    const ACTION_STATUS_NONE: u8 = 0;
    const ACTION_STATUS_APPROVED: u8 = 1;
    const ACTION_STATUS_REJECTED: u8 = 2;
    const ACTION_STATUS_EXECUTED: u8 = 3;
    const ACTION_STATUS_FAILED: u8 = 4;

    const EInvalidRecordType: u64 = 0;
    const EInvalidActorType: u64 = 1;
    const EInvalidActionStatus: u64 = 2;
    const ENotPolicyOwner: u64 = 3;

    public struct LedgerRecord has key, store {
        id: UID,
        owner: address,
        walrus_blob_id: vector<u8>,
        content_hash: vector<u8>,
        record_type: u8,
        created_at_ms: u64,
        evidence_blob_ids: vector<vector<u8>>,
        sealed: bool,
    }

    public struct RecordMetadata has key, store {
        id: UID,
        record_id: address,
        owner: address,
        actor_type: u8,
        actor_id: vector<u8>,
        tx_digest: vector<u8>,
        linked_policy_id: vector<u8>,
        action_status: u8,
    }

    public struct AgentPolicy has key, store {
        id: UID,
        owner: address,
        agent_id: vector<u8>,
        counterparty: vector<u8>,
        category: vector<u8>,
        max_amount: u64,
        approval_threshold: u64,
        allowed_token: vector<u8>,
        expires_at_ms: u64,
        revoked: bool,
        created_at_ms: u64,
    }

    public struct AgentActionLog has key, store {
        id: UID,
        owner: address,
        agent_id: vector<u8>,
        policy_id: vector<u8>,
        proposed_tx: vector<u8>,
        amount: u64,
        counterparty: vector<u8>,
        category: vector<u8>,
        status: u8,
        reason: vector<u8>,
        tx_digest: vector<u8>,
        created_at_ms: u64,
    }

    public struct RecordMinted has copy, drop {
        object_id: address,
        owner: address,
        walrus_blob_id: vector<u8>,
        record_type: u8,
        created_at_ms: u64,
    }

    public struct RecordMetadataMinted has copy, drop {
        metadata_id: address,
        record_id: address,
        owner: address,
        actor_type: u8,
        action_status: u8,
        created_at_ms: u64,
    }

    public struct AgentPolicyCreated has copy, drop {
        policy_id: address,
        owner: address,
        agent_id: vector<u8>,
        max_amount: u64,
        created_at_ms: u64,
    }

    public struct AgentPolicyRevoked has copy, drop {
        policy_id: address,
        owner: address,
        revoked_at_ms: u64,
    }

    public struct AgentActionLogged has copy, drop {
        action_id: address,
        owner: address,
        agent_id: vector<u8>,
        policy_id: vector<u8>,
        status: u8,
        created_at_ms: u64,
    }

    public fun mint(
        owner: address,
        walrus_blob_id: vector<u8>,
        content_hash: vector<u8>,
        record_type: u8,
        evidence_blob_ids: vector<vector<u8>>,
        sealed: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        mint_record(
            owner,
            walrus_blob_id,
            content_hash,
            record_type,
            evidence_blob_ids,
            sealed,
            ACTOR_TYPE_HUMAN,
            vector[],
            vector[],
            vector[],
            ACTION_STATUS_NONE,
            false,
            clock,
            ctx,
        );
    }

    public fun mint_with_actor(
        owner: address,
        walrus_blob_id: vector<u8>,
        content_hash: vector<u8>,
        record_type: u8,
        evidence_blob_ids: vector<vector<u8>>,
        sealed: bool,
        actor_type: u8,
        actor_id: vector<u8>,
        tx_digest: vector<u8>,
        linked_policy_id: vector<u8>,
        action_status: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        mint_record(
            owner,
            walrus_blob_id,
            content_hash,
            record_type,
            evidence_blob_ids,
            sealed,
            actor_type,
            actor_id,
            tx_digest,
            linked_policy_id,
            action_status,
            true,
            clock,
            ctx,
        );
    }

    fun mint_record(
        owner: address,
        walrus_blob_id: vector<u8>,
        content_hash: vector<u8>,
        record_type: u8,
        evidence_blob_ids: vector<vector<u8>>,
        sealed: bool,
        actor_type: u8,
        actor_id: vector<u8>,
        tx_digest: vector<u8>,
        linked_policy_id: vector<u8>,
        action_status: u8,
        emit_metadata: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(is_valid_record_type(record_type), EInvalidRecordType);
        assert!(is_valid_actor_type(actor_type), EInvalidActorType);
        assert!(is_valid_action_status(action_status), EInvalidActionStatus);

        let created_at_ms = clock::timestamp_ms(clock);

        let record = LedgerRecord {
            id: object::new(ctx),
            owner,
            walrus_blob_id,
            content_hash,
            record_type,
            created_at_ms,
            evidence_blob_ids,
            sealed,
        };
        let record_id = object::uid_to_address(&record.id);

        event::emit(RecordMinted {
            object_id: record_id,
            owner,
            walrus_blob_id: record.walrus_blob_id,
            record_type,
            created_at_ms,
        });

        transfer::transfer(record, owner);

        if (emit_metadata) {
            let metadata = RecordMetadata {
                id: object::new(ctx),
                record_id,
                owner,
                actor_type,
                actor_id,
                tx_digest,
                linked_policy_id,
                action_status,
            };

            event::emit(RecordMetadataMinted {
                metadata_id: object::uid_to_address(&metadata.id),
                record_id,
                owner,
                actor_type,
                action_status,
                created_at_ms,
            });

            transfer::transfer(metadata, owner);
        };
    }

    public fun create_agent_policy(
        owner: address,
        agent_id: vector<u8>,
        counterparty: vector<u8>,
        category: vector<u8>,
        max_amount: u64,
        approval_threshold: u64,
        allowed_token: vector<u8>,
        expires_at_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let created_at_ms = clock::timestamp_ms(clock);

        let policy = AgentPolicy {
            id: object::new(ctx),
            owner,
            agent_id,
            counterparty,
            category,
            max_amount,
            approval_threshold,
            allowed_token,
            expires_at_ms,
            revoked: false,
            created_at_ms,
        };

        event::emit(AgentPolicyCreated {
            policy_id: object::uid_to_address(&policy.id),
            owner,
            agent_id: policy.agent_id,
            max_amount,
            created_at_ms,
        });

        transfer::transfer(policy, owner);
    }

    public fun revoke_agent_policy(policy: &mut AgentPolicy, clock: &Clock, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotPolicyOwner);

        policy.revoked = true;
        let revoked_at_ms = clock::timestamp_ms(clock);

        event::emit(AgentPolicyRevoked {
            policy_id: object::uid_to_address(&policy.id),
            owner: policy.owner,
            revoked_at_ms,
        });
    }

    public fun log_agent_action(
        owner: address,
        agent_id: vector<u8>,
        policy_id: vector<u8>,
        proposed_tx: vector<u8>,
        amount: u64,
        counterparty: vector<u8>,
        category: vector<u8>,
        status: u8,
        reason: vector<u8>,
        tx_digest: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(is_valid_action_status(status), EInvalidActionStatus);

        let created_at_ms = clock::timestamp_ms(clock);
        let action = AgentActionLog {
            id: object::new(ctx),
            owner,
            agent_id,
            policy_id,
            proposed_tx,
            amount,
            counterparty,
            category,
            status,
            reason,
            tx_digest,
            created_at_ms,
        };

        event::emit(AgentActionLogged {
            action_id: object::uid_to_address(&action.id),
            owner,
            agent_id: action.agent_id,
            policy_id: action.policy_id,
            status,
            created_at_ms,
        });

        transfer::transfer(action, owner);
    }

    fun is_valid_record_type(record_type: u8): bool {
        record_type == RECORD_TYPE_PAYMENT_IN
            || record_type == RECORD_TYPE_PAYMENT_OUT
            || record_type == RECORD_TYPE_INSTRUCTION
            || record_type == RECORD_TYPE_EVIDENCE
    }

    fun is_valid_actor_type(actor_type: u8): bool {
        actor_type == ACTOR_TYPE_HUMAN || actor_type == ACTOR_TYPE_AGENT
    }

    fun is_valid_action_status(action_status: u8): bool {
        action_status == ACTION_STATUS_NONE
            || action_status == ACTION_STATUS_APPROVED
            || action_status == ACTION_STATUS_REJECTED
            || action_status == ACTION_STATUS_EXECUTED
            || action_status == ACTION_STATUS_FAILED
    }

    // Returns true if the provided hash matches the stored content hash.
    public fun verify_integrity(record: &LedgerRecord, claimed_hash: vector<u8>): bool {
        record.content_hash == claimed_hash
    }

    public fun blob_id(record: &LedgerRecord): &vector<u8> { &record.walrus_blob_id }
    public fun owner(record: &LedgerRecord): address { record.owner }
    public fun record_type(record: &LedgerRecord): u8 { record.record_type }
    public fun created_at_ms(record: &LedgerRecord): u64 { record.created_at_ms }
    public fun is_sealed(record: &LedgerRecord): bool { record.sealed }

    public fun metadata_record_id(metadata: &RecordMetadata): address { metadata.record_id }
    public fun metadata_actor_type(metadata: &RecordMetadata): u8 { metadata.actor_type }
    public fun metadata_actor_id(metadata: &RecordMetadata): &vector<u8> { &metadata.actor_id }
    public fun metadata_tx_digest(metadata: &RecordMetadata): &vector<u8> { &metadata.tx_digest }
    public fun metadata_linked_policy_id(metadata: &RecordMetadata): &vector<u8> { &metadata.linked_policy_id }
    public fun metadata_action_status(metadata: &RecordMetadata): u8 { metadata.action_status }

    public fun policy_owner(policy: &AgentPolicy): address { policy.owner }
    public fun policy_agent_id(policy: &AgentPolicy): &vector<u8> { &policy.agent_id }
    public fun policy_max_amount(policy: &AgentPolicy): u64 { policy.max_amount }
    public fun policy_revoked(policy: &AgentPolicy): bool { policy.revoked }

    public fun action_status_value(action: &AgentActionLog): u8 { action.status }
    public fun action_policy_id(action: &AgentActionLog): &vector<u8> { &action.policy_id }
}
