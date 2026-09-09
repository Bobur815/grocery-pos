import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Select } from '../../components/common/Select';
import { buildSampleReceiptHTML } from '../../../shared/receipt-html';
import type { ReceiptSettings as ReceiptSettingsType } from '../../../shared/receipt-html';
import { useToast } from '../../context/ToastContext';
import { useVirtualKeyboard } from '../../hooks/useVirtualKeyboard';
import {
  KeyboardToggle,
  KeyboardPanel,
} from '../../components/common/VirtualKeyboardControls';
import {
  ACCEPTED_LOGO_TYPES,
  ReceiptLogoError,
  prepareReceiptLogo,
} from '../../utils/receipt-logo';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const BackButton = styled(Button)``;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const ContentLayout = styled.div`
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Panel = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.lg};
`;

const PanelTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const StoreInfo = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.6;
  padding: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const PreviewContainer = styled.div`
  display: flex;
  justify-content: center;
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
  overflow: auto;
`;

const PreviewFrame = styled.iframe`
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: #fff;
  border-radius: 4px;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const FieldLabel = styled.label`
  display: block;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  font-weight: 500;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const LogoBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const LogoPreview = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 90px;
  padding: ${({ theme }) => theme.spacing.sm};
  background: #fff;
  border-radius: ${({ theme }) => theme.borderRadius};

  img {
    max-width: 100%;
    max-height: 120px;
    object-fit: contain;
  }
`;

const LogoHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const LogoActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const HiddenFileInput = styled.input`
  display: none;
`;

interface LogoFieldProps {
  label: string;
  /** Data URL of the configured image, or '' when none is set */
  value: string;
  /** Image width as a percentage of the paper width */
  size: string;
  onChange: (dataUrl: string) => void;
  onSizeChange: (size: string) => void;
}

/**
 * One receipt image slot (top or bottom) — upload, preview, resize, remove.
 * Each slot owns its own file input so the two are fully independent.
 */
function LogoField({ label, value, size, onChange, onSizeChange }: LogoFieldProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange
    e.target.value = '';
    if (!file) return;

    try {
      onChange(await prepareReceiptLogo(file));
    } catch (err) {
      const reason = err instanceof ReceiptLogoError ? err.reason : 'decode';
      console.error('Failed to prepare receipt logo:', err);
      showToast(t(`receipt.logoError.${reason}`), 'error');
    }
  };

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <LogoBox>
        {value ? (
          <>
            <LogoPreview>
              <img src={value} alt={label} />
            </LogoPreview>
            <Select
              label={t('receipt.logoSize')}
              selectSize="small"
              value={size}
              onChange={(e) => onSizeChange(e.target.value)}
              options={[
                { value: '30', label: '30%' },
                { value: '50', label: '50%' },
                { value: '70', label: '70%' },
                { value: '100', label: '100%' },
              ]}
            />
            <LogoActions>
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus size={16} /> {t('receipt.logoReplace')}
              </Button>
              <Button type="button" variant="danger" size="small" onClick={() => onChange('')}>
                <Trash2 size={16} /> {t('receipt.logoRemove')}
              </Button>
            </LogoActions>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={16} /> {t('receipt.logoUpload')}
            </Button>
            <LogoHint>{t('receipt.logoHint')}</LogoHint>
          </>
        )}
        <HiddenFileInput
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_LOGO_TYPES}
          onChange={handlePick}
        />
      </LogoBox>
    </div>
  );
}

export function ReceiptSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<ReceiptSettingsType>({
    receipt_width: '80',
    receipt_language: 'ru',
    receipt_header: '',
    receipt_footer: '',
    store_name: '',
    store_address: '',
    store_phone: '',
    store_stir: '',
    tax_rate: '0',
    receipt_logo_top: '',
    receipt_logo_top_size: '50',
    receipt_logo_bottom: '',
    receipt_logo_bottom_size: '50',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // On-screen keyboard for the free-text receipt fields. The paper width and language are selects,
  // and the logos are file pickers, so neither is wired.
  type Field = 'receipt_header' | 'receipt_footer';
  const keyboard = useVirtualKeyboard<Field>((field, edit) =>
    setSettings((prev) => ({ ...prev, [field]: edit(prev[field] ?? '') })),
  );

  useEffect(() => {
    (async () => {
      try {
        const all = await window.electronAPI.settings.getAll();
        setSettings({
          receipt_width: (all.receipt_width as '80' | '58') || '80',
          receipt_language: (all.receipt_language as 'ru' | 'uz') || 'ru',
          receipt_header: all.receipt_header || '',
          receipt_footer: all.receipt_footer || '',
          store_name: all.store_name || '',
          store_address: all.store_address || '',
          store_phone: all.store_phone || '',
          store_stir: all.store_stir || '',
          tax_rate: all.tax_rate || '0',
          receipt_logo_top: all.receipt_logo_top || '',
          receipt_logo_top_size: all.receipt_logo_top_size || '50',
          receipt_logo_bottom: all.receipt_logo_bottom || '',
          receipt_logo_bottom_size: all.receipt_logo_bottom_size || '50',
        });
      } catch (err) {
        console.error('Failed to load receipt settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const previewHtml = useMemo(() => buildSampleReceiptHTML(settings), [settings]);

  const iframeWidth = settings.receipt_width === '58' ? 220 : 305;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await window.electronAPI.settings.set('receipt_width', settings.receipt_width);
      await window.electronAPI.settings.set('receipt_language', settings.receipt_language);
      await window.electronAPI.settings.set('receipt_header', settings.receipt_header);
      await window.electronAPI.settings.set('receipt_footer', settings.receipt_footer);
      await window.electronAPI.settings.set('receipt_logo_top', settings.receipt_logo_top || '');
      await window.electronAPI.settings.set(
        'receipt_logo_top_size',
        settings.receipt_logo_top_size || '50'
      );
      await window.electronAPI.settings.set(
        'receipt_logo_bottom',
        settings.receipt_logo_bottom || ''
      );
      await window.electronAPI.settings.set(
        'receipt_logo_bottom_size',
        settings.receipt_logo_bottom_size || '50'
      );
      showToast(t('common.saved'), 'success');
    } catch (err) {
      console.error('Failed to save receipt settings:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Container>
        <Title>{t('common.loading')}</Title>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <BackButton variant="secondary" size="small" onClick={() => navigate('/settings')}>
          <ArrowLeft size={20} />
        </BackButton>
        <Title>{t('receipt.title')}</Title>
        <KeyboardToggle kb={keyboard} style={{ marginLeft: 'auto' }} />
      </Header>

      <ContentLayout>
        {/* Left panel — Settings */}
        <Panel>
          <PanelTitle>{t('receipt.title')}</PanelTitle>
          <Form onSubmit={handleSave}>
            <Row>
              <Select
                label={t('receipt.paperWidth')}
                value={settings.receipt_width}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    receipt_width: e.target.value as '80' | '58',
                  }))
                }
                options={[
                  { value: '80', label: t('receipt.width80') },
                  { value: '58', label: t('receipt.width58') },
                ]}
              />
              <Select
                label={t('receipt.language')}
                value={settings.receipt_language}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    receipt_language: e.target.value as 'ru' | 'uz',
                  }))
                }
                options={[
                  { value: 'ru', label: 'Русский' },
                  { value: 'uz', label: "O'zbek" },
                ]}
              />
            </Row>

            <Input
              label={t('receipt.header')}
              value={settings.receipt_header}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, receipt_header: e.target.value }))
              }
              {...keyboard.fieldProps('receipt_header')}
            />
            <Input
              label={t('receipt.footer')}
              value={settings.receipt_footer}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, receipt_footer: e.target.value }))
              }
              {...keyboard.fieldProps('receipt_footer')}
            />

            <LogoField
              label={t('receipt.logoTop')}
              value={settings.receipt_logo_top || ''}
              size={settings.receipt_logo_top_size || '50'}
              onChange={(dataUrl) =>
                setSettings((prev) => ({ ...prev, receipt_logo_top: dataUrl }))
              }
              onSizeChange={(size) =>
                setSettings((prev) => ({ ...prev, receipt_logo_top_size: size }))
              }
            />

            <LogoField
              label={t('receipt.logoBottom')}
              value={settings.receipt_logo_bottom || ''}
              size={settings.receipt_logo_bottom_size || '50'}
              onChange={(dataUrl) =>
                setSettings((prev) => ({ ...prev, receipt_logo_bottom: dataUrl }))
              }
              onSizeChange={(size) =>
                setSettings((prev) => ({ ...prev, receipt_logo_bottom_size: size }))
              }
            />

            <StoreInfo>
              {settings.store_name && <div><strong>{settings.store_name}</strong></div>}
              {settings.store_address && <div>{settings.store_address}</div>}
              {settings.store_phone && <div>{settings.store_phone}</div>}
              {settings.store_stir && <div>STIR: {settings.store_stir}</div>}
              {!settings.store_name && !settings.store_address && (
                <div>{t('receipt.storeInfoHint')}</div>
              )}
            </StoreInfo>

            <Actions>
              <Button type="submit" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </Actions>
          </Form>
        </Panel>

        {/* Right panel — Live preview */}
        <Panel>
          <PanelTitle>{t('receipt.preview')}</PanelTitle>
          <PreviewContainer>
            <PreviewFrame
              srcDoc={previewHtml}
              width={iframeWidth}
              height={500}
              title="Receipt preview"
            />
          </PreviewContainer>
        </Panel>
      </ContentLayout>

      <KeyboardPanel kb={keyboard} />
    </Container>
  );
}
