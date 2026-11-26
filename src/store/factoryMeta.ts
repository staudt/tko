// Fills factory-backed sounds with their manifest metadata (name, slices, root, hit names) once the
// factory sounds are decoded. Not an undoable edit.
//
// The factory lineup changed in manifest v2 (new melodic sounds). Rather than storing a per-sound
// version, a factory-backed sound counts as "untouched" while its name is still a default ("Sound N")
// or one of the names ever shipped in an earlier manifest; untouched sounds take name, kind, root and
// slices from the manifest. Once renamed by the user (or already equal to the manifest name) only
// missing slice data is filled in, so user edits to root/name stick.
import { apply } from './project';
import { factorySlots } from './samples';
import { FACTORY_PREFIX } from './defaults';

/** Names shipped in earlier manifests (v1 melodic lineup). Keep appending when the lineup changes again. */
const LEGACY_FACTORY_NAMES = new Set(['Round Bass', 'Glass Keys', 'Electric Piano', 'Soft Pad', 'Brass', 'Pluck Lead', 'Bell', 'Marimba']);
const DEFAULT_NAME = /^Sound \d+$/;

export async function applyFactoryMeta(): Promise<void> {
  const slots = await factorySlots();
  apply(
    (p) => {
      let changed = false;
      const sounds = p.sounds.map((s) => {
        if (!s.sampleId?.startsWith(FACTORY_PREFIX)) return s;
        const f = slots.find((x) => `${FACTORY_PREFIX}${x.slot}` === s.sampleId);
        if (!f) return s;
        const untouched = s.name !== f.name && (DEFAULT_NAME.test(s.name) || LEGACY_FACTORY_NAMES.has(s.name));
        const slices = f.kind === 'drum' ? f.slices : [];
        if (untouched) {
          changed = true;
          return { ...s, name: f.name, kind: f.kind, root: f.root, slices, hitNames: f.hitNames };
        }
        if (f.kind === 'drum' && !(s.slices.length > 0 && s.hitNames)) {
          changed = true;
          return { ...s, slices, hitNames: f.hitNames };
        }
        return s;
      });
      return changed ? { ...p, sounds } : p;
    },
    { undoable: false },
  );
}
