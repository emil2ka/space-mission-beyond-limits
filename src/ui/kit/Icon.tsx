// UI icons (ChatGPT, docs/05 Assets/UI/Icon List.md): public/icons/ui/<name>.webp (128 px) + <name>@2x.webp (256 px).
// <Icon name="dept_power" size={24} /> renders the kit's .ic slot as an <img> (decorative: alt="", text always sits next to it).
import type { CSSProperties } from 'react';

export const ICON_NAMES = [
  'dept_power', 'dept_propulsion', 'dept_navigation', 'dept_science', 'dept_comms', 'dept_structure',
  'dept_recovery', 'role_commander', 'role_engineer', 'role_science', 'role_comms', 'res_mass',
  'res_budget', 'res_credits', 'res_power_gen', 'res_power_use', 'res_battery', 'res_heat',
  'res_signal', 'res_data', 'res_fuel', 'st_ok', 'st_warn', 'st_crit',
  'st_info', 'st_locked', 'need_required', 'need_recommended', 'need_optional', 'need_useless',
  'act_add', 'act_remove', 'act_approve', 'act_veto', 'act_launch', 'act_radio',
  'act_settings', 'act_sound', 'act_sound_off', 'act_exit', 'act_replay', 'act_play',
  'act_pause', 'act_skip', 'fl_phase', 'fl_waypoint', 'fl_crisis', 'fl_blackout',
  'fl_rule', 'fl_timer', 'fl_hull', 'fl_sample', 'fl_capsule', 'fl_storm',
  'fl_debris', 'fl_log', 'mis_titan', 'mis_asteroid', 'hq_upgrade', 'hq_history',
  'hq_repair', 'hq_insurance',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export type IconSize = 20 | 24 | 32 | 48 | 64;

export const iconSrc = (name: IconName) => `/icons/ui/${name}.webp`;

export function Icon({ name, size = 24, className = '', style, title }: { name: IconName; size?: IconSize; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <img src={iconSrc(name)} srcSet={`/icons/ui/${name}@2x.webp 2x`} alt={title ?? ''} title={title} aria-hidden={title ? undefined : true}
      className={`ic ic--${size} ${className}`.trim()} style={style} width={size} height={size} draggable={false} decoding="async" />
  );
}
