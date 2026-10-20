import React from "react";

export function ManagedBadge() {
  return (
    <img
      src="/TipIn_Managed_Badge.png"
      alt="Managed by TipIn Game Manager"
      title="Managed by TipIn Game Manager"
      className="game-view-managed-badge"
      onError={(event) => event.currentTarget.remove()}
    />
  );
}
