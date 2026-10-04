import { Finish } from "./Finish";

export const metadata = { title: "Signing in · Ripplewise", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function FinishPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; to?: string }>;
}) {
  const { token, to } = await searchParams;
  return (
    <main id="main" className="mx-auto max-w-md p-6">
      <h1 className="text-[24px] font-semibold leading-8">Signing you in</h1>
      <div className="mt-4">
        <Finish token={token ?? ""} to={to ?? "/"} />
      </div>
    </main>
  );
}
