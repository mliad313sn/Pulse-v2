"use client";

// Role-adaptive home: layout switches on the signed-in user's division.

import { useApp } from "@/lib/store";
import { dashboardForDivision } from "@/components/dashboards";

export default function HomePage() {
  const { user } = useApp();

  if (!user) return null; // Providers shell shows the persona picker

  const Dashboard = dashboardForDivision(user.division);
  return <Dashboard />;
}
