import Link from "next/link";

// Shared wordmark: a low two-seater drawn in one line, with a neuron in the cabin whose dendrites reach both wheels.
export default function Brand({label}: {label: string}) {
  return (
    <Link className="brand" href="/" aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="2 15 44 23" width="38" height="20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.6 30.6H8.4M17.6 30.6H30.4M39.6 30.6H42.4C43.8 30.6 44.6 29.5 44.2 28.2L43.7 26.6C43.2 25.1 41.9 24.1 40.3 23.9L35 23.1C31.6 20.1 27.4 18.4 22.9 18.4C19.3 18.4 16.4 19.4 13.8 21.2L8.6 23.9C5.6 25 3.6 27 3.6 29C3.6 29.9 4.5 30.6 5.6 30.6Z" strokeWidth="3" />
          <circle cx="13" cy="30.6" r="4.1" strokeWidth="3" />
          <circle cx="35" cy="30.6" r="4.1" strokeWidth="3" />
          <path d="M23.6 24.4L16 28.4M23.6 24.4L32.2 28.4" strokeWidth="2.2" />
          <circle cx="23.6" cy="24.4" r="3.1" fill="currentColor" stroke="none" />
          <circle cx="13" cy="30.6" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="35" cy="30.6" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="brand-name">
        Car Neuron<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
