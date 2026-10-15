import test from 'node:test';
import { existsSync } from 'node:fs';
import { animationProductionCases, physicsProductionCases, uiProductionCases } from './helpers/production-cases.js';
import { runExtendedProductionCase } from './helpers/production-case-runner.js';

for (const definition of [...uiProductionCases(), ...physicsProductionCases(), ...animationProductionCases()]) {
  test(
    `T29 ${definition.id} fixed native ${definition.family} chain, illegal control, undo/redo and saved reopen`,
    { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 180000 },
    async () => {
      await runExtendedProductionCase(definition);
    },
  );
}
