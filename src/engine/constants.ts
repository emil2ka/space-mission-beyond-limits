import type { Department, RoleId } from './types';

/** 1 tick = 10 game minutes (decision 0005). */
export const TICK_HOURS = 1 / 6;
/** Real seconds per tick during flight. */
export const TICK_SECONDS = 1;

/** Heat balance thresholds (game units per tick). */
export const THERMAL = {
  freezing: -80,
  cold: -20,
  hot: 120,
  overheat: 200,
};

export const DEPARTMENTS: { id: Department; name: string; nameEn: string }[] = [
  { id: 'power', name: 'Энергия', nameEn: 'POWER SYSTEMS' },
  { id: 'propulsion', name: 'Двигатели', nameEn: 'PROPULSION' },
  { id: 'navigation', name: 'Навигация', nameEn: 'NAVIGATION & CONTROL' },
  { id: 'science', name: 'Наука', nameEn: 'SCIENCE PAYLOAD' },
  { id: 'comms', name: 'Связь', nameEn: 'COMMUNICATIONS' },
  { id: 'structure', name: 'Корпус и тепло', nameEn: 'STRUCTURE & THERMAL' },
  { id: 'recovery', name: 'Возвращение', nameEn: 'RETURN & RECOVERY' },
];

export const ROLES: { id: RoleId; name: string; nameEn: string; color: string }[] = [
  { id: 'commander', name: 'Командир', nameEn: 'Commander', color: '#FF9EC7' },
  { id: 'engineer', name: 'Главный инженер', nameEn: 'Chief Engineer', color: '#FF9A4A' },
  { id: 'science', name: 'Научный специалист', nameEn: 'Science Officer', color: '#5BE0E6' },
  { id: 'comms', name: 'Специалист связи', nameEn: 'Communications Officer', color: '#B8A9F0' },
];

/** Room code alphabet without look-alikes (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;
