import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScriptSemantics } from '../src/script-analysis.js';

test('analyzeScriptSemantics extracts Godot script semantics and state transitions', () => {
  const result = analyzeScriptSemantics(`extends CharacterBody2D
class_name Player
signal jumped(power: float)
@export var speed: float = 100.0
var state: State = IDLE
enum { IDLE, RUN, JUMP }
func _physics_process(delta):
    state = RUN
    if Input.is_action_just_pressed("jump"):
        state = JUMP
`);
  assert.equal(result.extends, 'CharacterBody2D');
  assert.equal(result.className, 'Player');
  assert.deepEqual(result.signals[0].parameters, ['power']);
  assert.equal(result.variables.find((v) => v.name === 'speed')?.export, true);
  assert.deepEqual(result.stateMachine.states.sort(), ['IDLE', 'JUMP', 'RUN'].sort());
  assert.equal(result.stateMachine.transitions.length, 2);
  assert.equal(result.stateMachine.transitions[1].to, 'JUMP');
  assert.ok(result.stateMachine.entryPoints.includes('_physics_process'));
});

test('analyzeScriptSemantics reports state variables without transitions', () => {
  const result = analyzeScriptSemantics('extends Node\nvar current_state: String = "idle"\n');
  assert.equal(result.stateMachine.stateVariable, 'current_state');
  assert.ok(result.diagnostics.some((item) => item.code === 'STATE_MACHINE_NO_TRANSITIONS'));
});
