import { useParams } from "react-router-dom";
import WithdrawalPhones from "./WithdrawalPhones";

export default function WithdrawalPhonesRoute() {
  const { walletId } = useParams<{ walletId: string }>();

  if (!walletId) {
    return <div className="p-4">Missing wallet id for withdrawal phones.</div>;
  }

  return <WithdrawalPhones matatuWalletId={walletId} />;
}
