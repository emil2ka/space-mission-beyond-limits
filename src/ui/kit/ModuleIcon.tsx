// Module icons rendered from the real GLBs (scripts/render-icons.mjs → public/icons/modules/<id>.webp 128 px + @2x 256 px,
// docs/05 Assets/UI/Module Icons.md). <ModuleIcon id="rtg" mission="asteroid" size={48} /> uses the mission variant
// (`<id>__asteroid`) when one was rendered, and falls back to the department icon when the file is missing or fails.
import { useState } from 'react';
import { COMPONENT_BY_ID, type MissionId } from '../../engine';
import { Icon, type IconName, type IconSize } from './Icon';
import { MODULE_ICON_IDS } from './moduleIconIds';

/** File key for a module (mission variant first), or null when no icon was rendered. */
export function moduleIconKey(id: string, mission?: MissionId | null): string | null {
  const variant = mission ? `${id}__${mission}` : '';
  if (variant && MODULE_ICON_IDS.has(variant)) return variant;
  return MODULE_ICON_IDS.has(id) ? id : null;
}

export function ModuleIcon({ id, mission, size = 32, className = '', title }: {
  id: string; mission?: MissionId | null; size?: IconSize; className?: string; title?: string;
}) {
  const key = moduleIconKey(id, mission);
  const [failed, setFailed] = useState<string | null>(null);
  const def = COMPONENT_BY_ID[id];
  if (!key || failed === key) {
    return def ? <Icon name={`dept_${def.department}` as IconName} size={size} className={className} title={title} /> : null;
  }
  return (
    <img src={`/icons/modules/${key}.webp`} srcSet={`/icons/modules/${key}@2x.webp 2x`} alt={title ?? ''} title={title}
      aria-hidden={title ? undefined : true} className={`ic ic--${size} ic--module ${className}`.trim()} width={size} height={size}
      loading="lazy" decoding="async" draggable={false} onError={() => setFailed(key)} />
  );
}
