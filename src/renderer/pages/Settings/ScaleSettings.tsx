import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../context/ToastContext';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
  max-width: 600px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Input = styled.input`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Select = styled.select`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const Row = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;


export function ScaleSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [labelPrinterName, setLabelPrinterName] = useState('');
  const [labelWidthMm, setLabelWidthMm] = useState('58');
  const [bulkWeighEnabled, setBulkWeighEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    window.electronAPI.settings.getAll().then((settings) => {
      if (settings.label_printer_name) setLabelPrinterName(settings.label_printer_name);
      if (settings.label_width_mm) setLabelWidthMm(settings.label_width_mm);
      setBulkWeighEnabled(settings.bulk_weigh_enabled === 'true');
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.electronAPI.settings.set('label_printer_name', labelPrinterName);
      await window.electronAPI.settings.set('label_width_mm', labelWidthMm);
      await window.electronAPI.settings.set(
        'bulk_weigh_enabled',
        bulkWeighEnabled ? 'true' : 'false',
      );
      toast.success(t('scaleSettings.saved'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      await window.electronAPI.printer.printWeightedLabel({
        productNameRu: 'Тест ярлык',
        productNameUz: 'Test yorliq',
        internalCode: '00001',
        barcode: '2000001015004',
        weightKg: 1.500,
        pricePerKg: 12000,
        totalPrice: 18000,
        date: new Date().toLocaleDateString('ru-RU'),
      });
      toast.success(t('printer.testSent'));
    } catch {
      toast.error(t('printer.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Container>
      <Header>
        <Button variant="secondary" size="small" onClick={() => navigate('/settings')}>
          <ArrowLeft size={20} />
        </Button>
        <Title>{t('scaleSettings.title')}</Title>
      </Header>

      <Card>
        <Row>
          <input
            type="checkbox"
            checked={bulkWeighEnabled}
            onChange={(e) => setBulkWeighEnabled(e.target.checked)}
          />
          {t('scaleSettings.bulkWeighEnabled')}
        </Row>
        <Hint>{t('scaleSettings.bulkWeighEnabledHint')}</Hint>

        <Field>
          <Label>{t('scaleSettings.labelPrinterName')}</Label>
          <Input
            value={labelPrinterName}
            onChange={(e) => setLabelPrinterName(e.target.value)}
            placeholder={t('printer.availablePrinters')}
          />
        </Field>

        <Field>
          <Label>{t('scaleSettings.labelWidthMm')}</Label>
          <Select value={labelWidthMm} onChange={(e) => setLabelWidthMm(e.target.value)}>
            <option value="40">40 мм</option>
            <option value="58">58 мм</option>
            <option value="80">80 мм</option>
          </Select>
        </Field>

        <ButtonRow>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={handleTestPrint} disabled={testing}>
            {testing ? t('common.processing') : t('scaleSettings.testPrint')}
          </Button>
        </ButtonRow>
      </Card>
    </Container>
  );
}
