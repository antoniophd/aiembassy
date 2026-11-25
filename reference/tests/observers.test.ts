// Who may speak for a group of States (2026-11-19), with invented names (2026-11-24): a Member
// State's delegation, an observer State, or a union speaking for its members; never an officer or a staff body.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extendSpeakers, isMemberState, speaksForStates } from '../engine/check/member-states.ts';
import './support/invented.ts';

extendSpeakers({ observers: ['Order of Saint Calvan'], unions: ['Union of Lakeland States', 'ULS'] });

test('observers and unions speak for groups; they are not Member States', () => {
  assert.ok(speaksForStates('Arvenia'));
  assert.ok(speaksForStates('Order of Saint Calvan · Observer'));
  assert.ok(speaksForStates('ULS · ULS'));
  assert.ok(speaksForStates('Union of Lakeland States'));
  assert.equal(isMemberState('Order of Saint Calvan'), false);
  assert.equal(isMemberState('ULS'), false);
  assert.equal(speaksForStates('GA · President'), false);
  assert.equal(speaksForStates('Staff Federation'), false);
});
