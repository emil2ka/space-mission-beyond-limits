// All dictionaries. Each area keeps its own fragment ({ ru, en }); en must have exactly the keys of ru.
// Fragments are plain data (no imports), so the engine can render Russian text from them too.
import type { Dict } from '../format';
import * as common from './common';
import * as ui_flight from './ui_flight';
import * as ui_screens from './ui_screens';
import * as ui_build from './ui_build';
import * as engine_report from './engine_report';
import * as engine_flight from './engine_flight';
import * as engine_room from './engine_room';

export const PART_LIST: Record<string, { ru: Dict; en: Dict }> = { common, ui_flight, ui_screens, ui_build, engine_report, engine_flight, engine_room };

export const RU: Dict = Object.assign({}, ...Object.values(PART_LIST).map((p) => p.ru));
export const EN: Dict = Object.assign({}, ...Object.values(PART_LIST).map((p) => p.en));
