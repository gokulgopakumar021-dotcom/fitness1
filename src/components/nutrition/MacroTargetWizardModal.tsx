import React from 'react';
import { NutritionGoalWizard, NutritionGoalWizardProps } from './NutritionGoalWizard';

export type MacroTargetWizardModalProps = NutritionGoalWizardProps;

export const MacroTargetWizardModal: React.FC<MacroTargetWizardModalProps> = (props) => {
  return <NutritionGoalWizard {...props} />;
};
