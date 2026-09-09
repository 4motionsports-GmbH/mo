"use client";

// Per-screen client chunks (TECH-E7). Every screen's client workspace is
// exported here through next/dynamic, so its JavaScript forms its own chunk and
// the browser downloads only the workspace of the screen it shows — not the
// client code of all ten. Server-side rendering stays on (the HTML of a screen
// arrives complete; React hydrates the workspace once its chunk is loaded), so
// nothing flashes. The server tabs import the workspaces from this file.

import dynamic from "next/dynamic";

export const KundenWorkspace = dynamic(() =>
  import("./kunden/KundenWorkspace").then((m) => m.KundenWorkspace)
);

export const KampagneWorkspace = dynamic(() =>
  import("./kampagne/KampagneWorkspace").then((m) => m.KampagneWorkspace)
);

export const GespraecheWorkspace = dynamic(() =>
  import("./gespraeche/GespraecheWorkspace").then((m) => m.GespraecheWorkspace)
);

export const WissenWorkspace = dynamic(() =>
  import("./wissen/WissenWorkspace").then((m) => m.WissenWorkspace)
);

export const FeedbackList = dynamic(() =>
  import("./feedback/FeedbackList").then((m) => m.FeedbackList)
);

export const AnalyseWorkspace = dynamic(() =>
  import("./analytics/AnalyseWorkspace").then((m) => m.AnalyseWorkspace)
);

export const VerbesserungWorkspace = dynamic(() =>
  import("./verbesserung/VerbesserungWorkspace").then((m) => m.VerbesserungWorkspace)
);

export const EmailSettingsWorkspace = dynamic(() =>
  import("./einstellungen/EmailSettingsWorkspace").then((m) => m.EmailSettingsWorkspace)
);
