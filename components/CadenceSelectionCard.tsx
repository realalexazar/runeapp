"use client"

type CadenceSelectionCardProps = {
  selectedCadence: string | null
  onSelect: (cadence: string) => void
}

export default function CadenceSelectionCard({
  selectedCadence
}: CadenceSelectionCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white">How often?</h2>
        <p className="mt-1 text-sm text-white/60">
          Closed alpha is locked to daily delivery for now.
        </p>
      </div>

      <div className="space-y-3">
        <div className="w-full text-left p-4 rounded-lg border bg-white/15 border-white/20">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">Daily</span>
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-200">
                  Locked for MVP
                </span>
              </div>
              <p className="mt-1 text-sm text-white/60">
                One digest per day. Additional cadence options return after alpha.
              </p>
            </div>
            {(selectedCadence ?? "daily") === "daily" && (
              <svg
                className="w-5 h-5 text-white flex-shrink-0 ml-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
