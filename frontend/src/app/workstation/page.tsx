import { MentalModelPane } from "@/components/web/workstation";

/**
 * /workstation root — 默认 landing = 心智模型 pane.
 *
 * 这是 R5.A 实施的唯一"真" pane. 其他 panes (kb / memory / agents / ...) 后续
 * Saga R5.B / R5.C / R5.D 实施, 当前仅 PlaceholderPane.
 */
export default function WorkstationRoot() {
  return <MentalModelPane />;
}
