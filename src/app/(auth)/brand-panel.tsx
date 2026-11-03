import Link from 'next/link';
import styles from './brand-panel.module.css';

/**
 * The left half of sign-in, registration and every other account page, in the
 * landing page's colours, so the front door and the forms behind it read as
 * one product. Hidden below the large breakpoint, where the form needs the room,
 * and held in view beside long forms such as registration.
 */
export function BrandPanel({
  heading,
  body,
  points,
  footnote,
}: {
  heading: React.ReactNode;
  body: string;
  points: string[];
  footnote: string;
}) {
  return (
    <section className={`relative hidden lg:flex lg:sticky lg:top-0 lg:h-screen flex-col justify-between overflow-hidden ${styles.panel}`}>
      <div className={styles.glow} aria-hidden />
      <Link href="/" className={styles.wordmark} aria-label="CareSync Hospital home">
        <b>CARE</b>SYNC
      </Link>

      <div className={styles.copy}>
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.body}>{body}</p>
        <ul className={styles.points}>
          {points.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      <p className={styles.foot}>{footnote}</p>
    </section>
  );
}

/** The wordmark above the form on small screens, where the panel is hidden. */
export function MobileWordmark() {
  return (
    <Link href="/" className={styles.mobileMark} aria-label="CareSync Hospital home">
      <b>CARE</b>SYNC
    </Link>
  );
}
