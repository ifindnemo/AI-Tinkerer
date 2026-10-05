import Image from "next/image";
import Link from "next/link";

// Shared wordmark for the landing page, the film and the dashboard.
export default function Brand({label}: {label: string}) {
  return (
    <Link className="brand" href="/" aria-label={label}>
      <span className="brand-mark">
        <Image src="/brand/car-neuron-logo.png" alt="" width={30} height={30} loading="eager" />
      </span>
      <span className="brand-name">
        Car Neuron<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
