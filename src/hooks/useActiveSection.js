import { useState } from 'react';
import { DEFAULT_SECTION } from '../config/dashboardButtons.js';

export function useActiveSection() {
  const [activeSection, setActiveSection] = useState(DEFAULT_SECTION);
  return { activeSection, selectSection: setActiveSection };
}
