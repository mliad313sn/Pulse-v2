"use client";

// Role-adaptive home: layout switches on the signed-in user's division.

import { useState } from "react";
import { useApp } from "@/lib/store";
import RoadblockSheet, { type RoadblockTarget } from "@/components/RoadblockSheet";
import OpsDashboard from "@/components/dashboards/OpsDashboard";
import InfraDashboard from "@/components/dashboards/InfraDashboard";
import InfosecDashboard from "@/components/dashboards/InfosecDashboard";
import ManagementDashboard from "@/components/dashboards/ManagementDashboard";
import PortfolioDashboard from "@/components/dashboards/PortfolioDashboard";

export default function HomePage() {
  const { user } = useApp();
  const [roadblockTarget, setRoadblockTarget] = useState<RoadblockTarget | null>(null);

  if (!user) return null; // Providers shell shows the persona picker

  let dashboard: React.ReactNode;
  switch (user.division) {
    case "ops":
      dashboard = <OpsDashboard onRoadblock={setRoadblockTarget} />;
      break;
    case "infra":
      dashboard = <InfraDashboard onRoadblock={setRoadblockTarget} />;
      break;
    case "infosec":
      dashboard = <InfosecDashboard />;
      break;
    case "management":
      dashboard = <ManagementDashboard />;
      break;
    default:
      dashboard = <PortfolioDashboard />;
  }

  return (
    <>
      {dashboard}
      <RoadblockSheet target={roadblockTarget} onClose={() => setRoadblockTarget(null)} />
    </>
  );
}
