// Division -> dashboard registry. Adding a division's dashboard is one entry here;
// anything unlisted falls back to the generic PortfolioDashboard.
// (Labels/colors stay in DIVISION_META in lib/utils — no React imports there.)

import type { ComponentType } from "react";
import OpsDashboard from "./OpsDashboard";
import InfraDashboard from "./InfraDashboard";
import InfosecDashboard from "./InfosecDashboard";
import ManagementDashboard from "./ManagementDashboard";
import PortfolioDashboard from "./PortfolioDashboard";

const DASHBOARDS: Record<string, ComponentType> = {
  ops: OpsDashboard,
  infra: InfraDashboard,
  infosec: InfosecDashboard,
  management: ManagementDashboard,
};

export function dashboardForDivision(division: string | null | undefined): ComponentType {
  return DASHBOARDS[division ?? ""] ?? PortfolioDashboard;
}
