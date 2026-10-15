/**
 * 屏登记表（spec §1.1/§1.2）：shell 持有注册表；未注册的屏 id 是类型化
 * 拒绝（unregistered_screen），逐字展示。lanes 在自己的 screens/ 子树
 * 里构造 registration 并交给 shell —— 不经注册表就永远到不了屏。
 */
import { ARENA_SCREEN_IDS, type ArenaScreenId, type ArenaScreenRegistration } from "../contract.js";

export class ArenaScreenRegistry {
  private readonly registrations = new Map<ArenaScreenId, ArenaScreenRegistration>();

  register(registration: ArenaScreenRegistration): void {
    if (!ARENA_SCREEN_IDS.includes(registration.screen)) {
      throw new Error(
        `arena-shell: screen id "${registration.screen}" is not in the frozen vocabulary`,
      );
    }
    this.registrations.set(registration.screen, registration);
  }

  lookup(screen: ArenaScreenId): ArenaScreenRegistration | undefined {
    return this.registrations.get(screen);
  }

  registeredScreens(): ArenaScreenId[] {
    return ARENA_SCREEN_IDS.filter((id) => this.registrations.has(id));
  }
}
