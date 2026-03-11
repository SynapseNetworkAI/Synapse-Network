import Link from "next/link";

export default function OverviewHero() {
  return (
    <div className="max-w-3xl">
      <p className="text-xs tracking-widest text-green-300 uppercase">Overview</p>
      <h2 className="mt-2 text-3xl font-black leading-tight text-white md:text-4xl">
        Synapse Network：让 Agent 安全调用 API，并自动完成扣费与结算
      </h2>
      <p className="mt-4 text-sm leading-7 text-gray-400">
        买家充值后可用凭据发起高频调用；卖家接入 API 后按调用量获得收益；平台按费率自动抽取服务费。
      </p>

      <div className="flex flex-wrap gap-2 mt-5">
        <Link href="/dashboard/credentials" className="px-4 py-2 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400">
          我是买家：充值并开始调用
        </Link>
        <Link href="/dashboard/services" className="px-4 py-2 text-sm font-semibold text-white transition-colors border border-gray-700 rounded-lg hover:bg-gray-900">
          我是卖家：接入服务并开始赚钱
        </Link>
      </div>
    </div>
  );
}
