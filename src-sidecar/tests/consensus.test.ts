import { describe, it, expect } from 'vitest';
import { ConsensusProtocol } from '../src/consensus';
import type { ConsensusConfig } from '../src/types';

const defaultConfig: ConsensusConfig = {
  maxRounds: 3,
  requiredMajority: 0.66,
};

describe('ConsensusProtocol', () => {
  it('detects unanimous agreement', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: microservices is the way');
    protocol.recordPosition('agent-2', 'AGREE: microservices sounds right');
    protocol.recordPosition('agent-3', 'AGREE: let us go with microservices');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('reached');
    if (result.status === 'reached') {
      expect(result.supporters).toEqual(['agent-1', 'agent-2', 'agent-3']);
    }
  });

  it('detects supermajority agreement', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A');
    protocol.recordPosition('agent-2', 'AGREE: option A');
    protocol.recordPosition('agent-3', 'DISAGREE: I prefer option B');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('reached');
    if (result.status === 'reached') {
      expect(result.supporters).toEqual(['agent-1', 'agent-2']);
    }
  });

  it('does not reach consensus without supermajority', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A');
    protocol.recordPosition('agent-2', 'DISAGREE: prefer B');
    protocol.recordPosition('agent-3', 'DISAGREE: prefer C');

    const result = protocol.evaluate(['agent-1', 'agent-2', 'agent-3']);

    expect(result.status).toBe('no_consensus');
  });

  it('tracks round count', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    expect(protocol.currentRound).toBe(0);
    protocol.nextRound();
    expect(protocol.currentRound).toBe(1);
    protocol.nextRound();
    expect(protocol.currentRound).toBe(2);
  });

  it('detects when max rounds exceeded', () => {
    const config: ConsensusConfig = { maxRounds: 2, requiredMajority: 0.66 };
    const protocol = new ConsensusProtocol(config);

    protocol.nextRound();
    expect(protocol.shouldEscalate()).toBe(false);

    protocol.nextRound();
    expect(protocol.shouldEscalate()).toBe(true);
  });

  it('generates escalation summary', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: option A because performance');
    protocol.recordPosition('agent-2', 'DISAGREE: option B because simplicity');

    const summary = protocol.getEscalationSummary();

    expect(summary).toHaveLength(2);
    expect(summary[0].agentId).toBe('agent-1');
    expect(summary[0].position).toContain('option A');
    expect(summary[0].agrees).toBe(true);
    expect(summary[1].agentId).toBe('agent-2');
    expect(summary[1].agrees).toBe(false);
  });

  it('resets state for new consensus', () => {
    const protocol = new ConsensusProtocol(defaultConfig);

    protocol.recordPosition('agent-1', 'AGREE: something');
    protocol.nextRound();
    protocol.reset();

    expect(protocol.currentRound).toBe(0);
    expect(protocol.getEscalationSummary()).toHaveLength(0);
  });
});
