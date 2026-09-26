import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { EDITOR_PROTOCOL, EditorBridge } from '../../src/editor/editor-bridge.js';

/** Public editor APIs in a TEST-ONLY controller; never copied to a user's project. */
const controller = `@tool
extends EditorPlugin
func _enter_tree() -> void:
\tset_process(true)
func _process(_delta: float) -> void:
\tvar root := EditorInterface.get_edited_scene_root()
\tif root == null or not FileAccess.file_exists("res://.harness/fixture-command.json"):
\t\treturn
\tvar command: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://.harness/fixture-command.json"))
\tDirAccess.remove_absolute(ProjectSettings.globalize_path("res://.harness/fixture-command.json"))
\tif command.action == "dirty-select":
\t\tEditorInterface.get_selection().clear()
\t\tEditorInterface.get_selection().add_node(root.get_node("Marker"))
\t\tEditorInterface.mark_scene_as_unsaved()
\telif command.action == "disable":
\t\tEditorInterface.set_plugin_enabled("wheel_mcp", false)
\telif command.action == "human-move":
\t\troot.get_node("Marker").position = Vector2(123, 456)
\t\tEditorInterface.mark_scene_as_unsaved()
\telif command.action in ["undo", "redo"]:
\t\tvar history := get_undo_redo().get_history_undo_redo(get_undo_redo().get_object_history_id(root))
\t\tif command.action == "undo": history.undo()
\t\telse: history.redo()
\telif command.action == "enable":
\t\tEditorInterface.set_plugin_enabled("wheel_mcp", true)
\tvar file := FileAccess.open("res://.harness/fixture-result.json", FileAccess.WRITE)
\tfile.store_string(JSON.stringify(command))
\tfile.close()
\tif command.action == "quit": get_tree().call_deferred("quit")
`;

export async function waitUntil<T>(read: () => Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (value !== undefined) return value;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error('Editor fixture condition timed out');
}

export async function startEditorFixture(
  godotPath: string,
  options: {
    controller?: string;
    scene?: string;
    files?: Record<string, string>;
    writeEnabled?: boolean;
    /** TEST ONLY: reopen an existing isolated temporary fixture without replacing scene bytes. */
    existingRoot?: string;
    writeCommand?: (stagedPath: string, json: string) => Promise<void>;
  } = {},
) {
  const root = options.existingRoot
    ? await realpath(options.existingRoot)
    : await realpath(await mkdtemp(path.join(os.tmpdir(), 'wheel-editor-')));
  const fixtureRelative = path.relative(await realpath(os.tmpdir()), root);
  if (!fixtureRelative.startsWith('wheel-editor-') || fixtureRelative.includes(path.sep))
    throw new Error('Only isolated fixture roots may be reopened');
  await mkdir(path.join(root, '.harness'), { recursive: true });
  await mkdir(path.join(root, 'addons/fixture_control'), { recursive: true });
  await cp(path.resolve('godot-plugin/addons/wheel_mcp'), path.join(root, 'addons/wheel_mcp'), { recursive: true });
  await writeFile(
    path.join(root, 'addons/fixture_control/plugin.cfg'),
    '[plugin]\nname="Fixture controller"\nscript="control.gd"\n',
  );
  await writeFile(path.join(root, 'addons/fixture_control/control.gd'), options.controller ?? controller);
  const project =
    '[application]\nconfig/name="Wheel editor fixture"\nrun/main_scene="res://main.tscn"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/wheel_mcp/plugin.cfg", "res://addons/fixture_control/plugin.cfg")\n';
  await writeFile(path.join(root, 'project.godot'), project);
  const scene =
    options.scene ??
    '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Marker" type="Node2D" parent="."]\nposition = Vector2(40, 0)\n';
  if (!options.existingRoot) await writeFile(path.join(root, 'main.tscn'), scene);
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const target = path.resolve(root, relative);
    const within = path.relative(root, target);
    if (!within || within.startsWith('..') || path.isAbsolute(within)) throw new Error('Fixture file escapes root');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const token = randomBytes(32).toString('hex');
  const config = {
    schemaVersion: 1,
    enabled: true,
    authorized: true,
    protocolVersion: EDITOR_PROTOCOL,
    projectId: 'editor-fixture',
    projectPath: root.replaceAll('\\', '/'),
    port: 0,
    clients: { 'local-client': token, 'stdio-local': randomBytes(32).toString('hex') },
    ...(options.writeEnabled
      ? {
          writeClients: {
            'local-client': randomBytes(32).toString('hex'),
            'stdio-local': randomBytes(32).toString('hex'),
          },
        }
      : {}),
  };
  await writeFile(path.join(root, '.harness/editor-bridge.json'), JSON.stringify(config), { mode: 0o600 });
  const child = spawn(
    godotPath,
    ['--headless', '--editor', '--path', root, 'res://main.tscn', '--log-file', path.join(root, '.harness/editor.log')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  };
  const readEndpoint = async () => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Editor exited ${child.exitCode}: ${output}`);
    try {
      return JSON.parse(await readFile(path.join(root, '.harness/editor-endpoint.json'), 'utf8')) as Record<
        string,
        any
      >;
    } catch {
      return undefined;
    }
  };
  try {
    const endpoint = await waitUntil(readEndpoint);
    // Publishing a listener is not evidence that the scene has finished opening.
    await waitUntil(async () => {
      const bridge = await EditorBridge.connect({ projectPath: root, ownerId: 'local-client' });
      try {
        return (await bridge.snapshot()).currentScene ? true : undefined;
      } finally {
        bridge.close();
      }
    });
    return {
      root,
      token,
      config,
      endpoint,
      project,
      scene,
      stop,
      exited,
      pid: child.pid,
      readEndpoint,
      output: () => output,
      async command(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, any>> {
        const id = randomBytes(8).toString('hex');
        // Godot polls per frame: never publish an empty/partially written JSON.
        // The optional writer is TEST-ONLY fault injection into the staged file.
        const staged = path.join(root, `.harness/fixture-command-${id}.staged`);
        await (options.writeCommand ?? writeFile)(staged, JSON.stringify({ ...payload, action, id }));
        await rename(staged, path.join(root, '.harness/fixture-command.json'));
        return await waitUntil(async () => {
          if (output.includes('SCRIPT ERROR')) throw new Error(output);
          try {
            const reply = JSON.parse(await readFile(path.join(root, '.harness/fixture-result.json'), 'utf8'));
            return reply.id === id ? reply : undefined;
          } catch {
            return undefined;
          }
        });
      },
    };
  } catch (error) {
    await stop();
    throw new Error(`${error instanceof Error ? error.message : error}\n${output}`, { cause: error });
  }
}
