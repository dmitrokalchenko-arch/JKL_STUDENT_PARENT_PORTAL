import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { SUPPORTED_LANGUAGES, getLanguageByCode } from '../../../i18n/languages.js';
import { changeLanguage } from '../../../i18n/index.js';
import styles from './LanguageSwitcher.module.css';

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const itemRefs = useRef([]);

  const current = getLanguageByCode(i18n.language);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      const currentIndex = SUPPORTED_LANGUAGES.findIndex((lang) => lang.code === current.code);
      setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [open, current.code]);

  useEffect(() => {
    if (open) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [open, activeIndex]);

  async function handleSelect(code) {
    await changeLanguage(code);
    setOpen(false);
  }

  function handleButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % SUPPORTED_LANGUAGES.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + SUPPORTED_LANGUAGES.length) % SUPPORTED_LANGUAGES.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(SUPPORTED_LANGUAGES[activeIndex].code);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className={styles.wrap} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('language.switcherLabel')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleButtonKeyDown}
      >
        <span>{current.shortLabel}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <ul
          className={styles.menu}
          role="listbox"
          aria-label={t('language.menuLabel')}
          onKeyDown={handleMenuKeyDown}
        >
          {SUPPORTED_LANGUAGES.map((language, index) => {
            const isSelected = language.code === current.code;
            return (
              <li key={language.code} role="presentation">
                <button
                  type="button"
                  ref={(el) => (itemRefs.current[index] = el)}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={index === activeIndex ? 0 : -1}
                  className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                  onClick={() => handleSelect(language.code)}
                  dir={language.direction}
                >
                  <span className={styles.optionCode}>{language.shortLabel}</span>
                  <span className={styles.optionName}>{language.nativeName}</span>
                  {isSelected && <Icon name="check" size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
