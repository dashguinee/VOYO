/**
 * DAHUB Components for VOYO
 *
 * ONE Dahub - Command Center's unified social layer
 * Same friends, same messages, same presence across all apps
 */

export { DahubCore } from './DahubCore';
export type { DahubCoreProps } from './DahubCore';
export { Dahub } from './Dahub';
export { DirectMessageChat } from './DirectMessageChat';
export { VoyoDahub } from './VoyoDahub';

// Re-export API
export {
  friendsAPI,
  messagesAPI,
  presenceAPI,
  activityAPI,
  APP_CODES,
  APP_DISPLAY,
  getAppDisplay,
  formatActivity,
  isDahubConfigured
} from '../../lib/dahub/dahub-api';

export type {
  Friend,
  Message,
  Conversation,
  UserPresence,
  FriendActivity,
  AppCode,
  SharedAccountMember,
  SharedService
} from '../../lib/dahub/dahub-api';

export { SERVICE_DISPLAY } from '../../lib/dahub/dahub-api';
