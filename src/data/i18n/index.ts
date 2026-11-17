/**
 * AG-78 i18n 清点——词典模块公共面（字典骨架，零接入）。
 *
 * 本文件只有字典类型与 t(key) 的**函数签名**——不含任何接线逻辑
 * （不读 GameState、不 import Phaser、不做 locale 持久化）。
 * t() 的占位符替换实现与 locale 状态源留给后续接线工单；在它落地前，
 * 这里用 declare 占位，保证编译期签名稳定、运行期零副作用。
 *
 * 属主：AG-78。
 */

import type { zhCN } from './zh-CN';

/** 词典 key（语义化 `<域>.<对象>[.<属性>]`，以 zh-CN 为唯一事实源）。 */
export type I18nKey = keyof typeof zhCN;

/** t() 的占位符参数：{name} → 值。 */
export type I18nParams = Record<string, string | number>;

/** 一部词典的形状：每个 key 一条字符串。 */
export type I18nDictionary = Record<I18nKey, string>;

/**
 * 取一条文案。占位符写法见 zh-CN.ts 头部注释（{n} / {name} / {gold}…）。
 *
 * 签名占位：实现（占位符替换 + locale 选择）随接线工单落地，
 * 届时把本行替换为真实函数，调用方无需改动。
 */
export declare function t(key: I18nKey, params?: I18nParams): string;
