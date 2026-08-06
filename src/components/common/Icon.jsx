const paths = {
  bell: 'M12 2a6 6 0 0 0-6 6v3.2c0 .6-.24 1.18-.66 1.6L4 14.2V16h16v-1.8l-1.34-1.4a2.3 2.3 0 0 1-.66-1.6V8a6 6 0 0 0-6-6Zm0 20a2.4 2.4 0 0 0 2.4-2.4h-4.8A2.4 2.4 0 0 0 12 22Z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.4 4a7.9 7.9 0 0 0-.14-1.5l2-1.56-2-3.46-2.36.96a8 8 0 0 0-1.3-.76L16.2 3h-4l-.4 2.68a8 8 0 0 0-1.3.76l-2.36-.96-2 3.46 2 1.56A7.9 7.9 0 0 0 8 12a7.9 7.9 0 0 0 .14 1.5l-2 1.56 2 3.46 2.36-.96c.4.3.84.56 1.3.76L12.2 21h4l.4-2.68a8 8 0 0 0 1.3-.76l2.36.96 2-3.46-2-1.56c.1-.49.14-.99.14-1.5Z',
  logout: 'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm5.6 4-1.4 1.4 2.6 2.6H8v2h8.8l-2.6 2.6L15.6 17l5-5-5-5Z',
  chevronDown: 'M6 9l6 6 6-6',
  calendar: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 7H5v9h14V9Z',
  family: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 2c-3 0-6 1.5-6 4v2h12v-2c0-2.5-3-4-6-4Zm8 0c-.6 0-1.2.06-1.75.16 1.1.9 1.75 2.1 1.75 3.84v2h6v-2c0-2.5-3-4-6-4Z',
  trophy: 'M6 3h12v2h2v3a4 4 0 0 1-4 4h-.2A5 5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A5 5 0 0 1 8.2 12H8a4 4 0 0 1-4-4V5h2V3Zm0 4H4a2 2 0 0 0 2 2V7Zm14 0h-2v2a2 2 0 0 0 2-2Z',
  certificate: 'M6 2h9l3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 5V3.5L17.5 8H15a2 2 0 0 1-2-2ZM7 12h10v2H7v-2Zm0 4h6v2H7v-2Z',
  event: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm2 9h2v2H9v-2Zm4 0h2v2h-2v-2Z',
  belt: 'M2 10h20v4H2v-4Zm7-4h6l2 4-2 4H9l-2-4 2-4Z',
  contract: 'M6 2h9l3 3v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 6h3.5L14 3.5V8ZM7 12h10v2H7v-2Zm0 4h7v2H7v-2Z',
  check: 'M20 6 9 17l-5-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm.75-14h-1.5v6l5 3 .75-1.25-4.25-2.5V7Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  arrowRight: 'M5 12h13m0 0-5-5m5 5-5 5',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5v14l11-7-11-7Z',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M21 21l-4.35-4.35'
};

export default function Icon({ name, size = 18, color = 'currentColor', className }) {
  const d = paths[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} fill={['check', 'chevronDown', 'arrowRight', 'close', 'search'].includes(name) ? 'none' : color} stroke={['check', 'chevronDown', 'arrowRight', 'close', 'search'].includes(name) ? color : 'none'} />
    </svg>
  );
}
