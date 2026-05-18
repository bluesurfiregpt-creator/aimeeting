"use client";

/** v27.0-mobile · /m/insights · Phase 2-next 占位. */

import PageHeader from "@/components/mobile/PageHeader";

export default function MobileInsightsPage() {
  return (
    <div>
      <PageHeader title="智囊" />
      <div className="px-4 pb-6">
        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">
          <div className="text-3xl">💡</div>
          <p className="mt-4 text-[16px] text-zinc-200">智囊 · 三 tab 视图</p>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
            Phase 2-next 来真做:<br />
            [AI 产出] · [待我审] · [已入库]<br />
            可按专家 / 议题 / 时间索引
          </p>
        </div>
      </div>
    </div>
  );
}
