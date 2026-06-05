#[test_only]
module ledger::record_tests {
    use sui::test_scenario as ts;
    use sui::clock;
    use ledger::record::{
        Self,
        LedgerRecord,
        RecordMetadata,
        AgentPolicy,
        AgentActionLog,
    };

    const OWNER: address = @0xA11CE;
    const OTHER: address = @0xB0B;

    // Record type / actor / status constants mirrored from the contract.
    const RECORD_TYPE_PAYMENT_IN: u8 = 0;
    const RECORD_TYPE_EVIDENCE: u8 = 3;
    const ACTOR_TYPE_AGENT: u8 = 1;
    const ACTION_STATUS_EXECUTED: u8 = 3;
    const ACTION_STATUS_REJECTED: u8 = 2;

    #[test]
    fun mint_creates_record_with_expected_fields() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::mint(
            OWNER,
            b"blob-123",
            b"hash-abc",
            RECORD_TYPE_PAYMENT_IN,
            vector[b"evidence-1"],
            false,
            &clock,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let record = ts::take_from_sender<LedgerRecord>(&scenario);
        assert!(record::owner(&record) == OWNER, 0);
        assert!(record::record_type(&record) == RECORD_TYPE_PAYMENT_IN, 1);
        assert!(*record::blob_id(&record) == b"blob-123", 2);
        assert!(record::is_sealed(&record) == false, 3);
        assert!(record::verify_integrity(&record, b"hash-abc"), 4);
        assert!(!record::verify_integrity(&record, b"wrong-hash"), 5);
        ts::return_to_sender(&scenario, record);

        // Plain mint must NOT emit RecordMetadata.
        assert!(!ts::has_most_recent_for_sender<RecordMetadata>(&scenario), 6);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ledger::record::EInvalidRecordType)]
    fun mint_rejects_invalid_record_type() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::mint(
            OWNER,
            b"blob",
            b"hash",
            99, // invalid record type
            vector[],
            false,
            &clock,
            ts::ctx(&mut scenario),
        );

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun mint_with_actor_emits_metadata() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::mint_with_actor(
            OWNER,
            b"blob-xyz",
            b"hash-xyz",
            RECORD_TYPE_EVIDENCE,
            vector[],
            true,
            ACTOR_TYPE_AGENT,
            b"agent-7",
            b"digest-9",
            b"policy-3",
            ACTION_STATUS_EXECUTED,
            &clock,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let record = ts::take_from_sender<LedgerRecord>(&scenario);
        assert!(record::is_sealed(&record), 0);
        assert!(record::record_type(&record) == RECORD_TYPE_EVIDENCE, 1);
        ts::return_to_sender(&scenario, record);

        let metadata = ts::take_from_sender<RecordMetadata>(&scenario);
        assert!(record::metadata_actor_type(&metadata) == ACTOR_TYPE_AGENT, 2);
        assert!(*record::metadata_actor_id(&metadata) == b"agent-7", 3);
        assert!(*record::metadata_tx_digest(&metadata) == b"digest-9", 4);
        assert!(*record::metadata_linked_policy_id(&metadata) == b"policy-3", 5);
        assert!(record::metadata_action_status(&metadata) == ACTION_STATUS_EXECUTED, 6);
        ts::return_to_sender(&scenario, metadata);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ledger::record::EInvalidActorType)]
    fun mint_with_actor_rejects_invalid_actor_type() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::mint_with_actor(
            OWNER,
            b"blob",
            b"hash",
            RECORD_TYPE_PAYMENT_IN,
            vector[],
            false,
            99, // invalid actor type
            b"agent",
            b"digest",
            b"policy",
            ACTION_STATUS_EXECUTED,
            &clock,
            ts::ctx(&mut scenario),
        );

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun create_policy_then_owner_revokes() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::create_agent_policy(
            OWNER,
            b"agent-1",
            b"emeka",
            b"fuel",
            70000,
            10000,
            b"NGN",
            0,
            &clock,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let mut policy = ts::take_from_sender<AgentPolicy>(&scenario);
        assert!(record::policy_owner(&policy) == OWNER, 0);
        assert!(record::policy_max_amount(&policy) == 70000, 1);
        assert!(*record::policy_agent_id(&policy) == b"agent-1", 2);
        assert!(!record::policy_revoked(&policy), 3);

        record::revoke_agent_policy(&mut policy, &clock, ts::ctx(&mut scenario));
        assert!(record::policy_revoked(&policy), 4);
        ts::return_to_sender(&scenario, policy);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ledger::record::ENotPolicyOwner)]
    fun non_owner_cannot_revoke_policy() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::create_agent_policy(
            OWNER,
            b"agent-1",
            b"emeka",
            b"fuel",
            70000,
            0,
            b"NGN",
            0,
            &clock,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let mut policy = ts::take_from_sender<AgentPolicy>(&scenario);

        // A different sender attempts to revoke.
        ts::next_tx(&mut scenario, OTHER);
        record::revoke_agent_policy(&mut policy, &clock, ts::ctx(&mut scenario));

        ts::return_to_address(OWNER, policy);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    fun log_agent_action_records_status() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::log_agent_action(
            OWNER,
            b"agent-1",
            b"policy-1",
            b"pay emeka 5000",
            5000,
            b"emeka",
            b"fuel",
            ACTION_STATUS_REJECTED,
            b"over cap",
            b"",
            &clock,
            ts::ctx(&mut scenario),
        );

        ts::next_tx(&mut scenario, OWNER);
        let action = ts::take_from_sender<AgentActionLog>(&scenario);
        assert!(record::action_status_value(&action) == ACTION_STATUS_REJECTED, 0);
        assert!(*record::action_policy_id(&action) == b"policy-1", 1);
        ts::return_to_sender(&scenario, action);

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ledger::record::EInvalidActionStatus)]
    fun log_agent_action_rejects_invalid_status() {
        let mut scenario = ts::begin(OWNER);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));

        record::log_agent_action(
            OWNER,
            b"agent-1",
            b"policy-1",
            b"pay",
            5000,
            b"emeka",
            b"fuel",
            99, // invalid status
            b"reason",
            b"",
            &clock,
            ts::ctx(&mut scenario),
        );

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
