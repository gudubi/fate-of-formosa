import type { EventDef } from '../../sim/types';
import disasterEconomy from './disaster_economy.json';
import straitIntl from './strait_intl.json';
import politicsPublic from './politics_public.json';
import eggs from './eggs.json';

export const ALL_EVENTS = [
  ...disasterEconomy, ...straitIntl, ...politicsPublic, ...eggs,
] as unknown as EventDef[];
