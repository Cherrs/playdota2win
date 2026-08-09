import { useState } from 'react';
import { classNames } from './classNames';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
	value?: string;
	onSelect: (color: string) => void;
}

const PRESET_COLORS = [
	['粉红', '#FF6B9D'],
	['紫色', '#6B4C9A'],
	['蓝色', '#667EEA'],
	['天蓝', '#4FC3F7'],
	['青色', '#26C6DA'],
	['绿色', '#66BB6A'],
	['黄绿', '#9CCC65'],
	['黄色', '#FFCA28'],
	['橙色', '#FFA726'],
	['深橙', '#FF7043'],
	['红色', '#EF5350'],
	['玫红', '#EC407A']
] as const;

export default function ColorPicker({ value = '', onSelect }: ColorPickerProps) {
	const [customColor, setCustomColor] = useState(value || '#667EEA');
	const [showCustomInput, setShowCustomInput] = useState(false);

	function selectColor(color: string): void {
		setCustomColor(color);
		onSelect(color);
	}

	return (
		<div className={styles.picker}>
			<div className={styles.presets}>
				{PRESET_COLORS.map(([name, color]) => (
					<button
						key={color}
						type="button"
						title={name}
						aria-label={name}
						className={classNames(styles.color, value === color && styles.selected)}
						style={{ backgroundColor: color }}
						onClick={() => selectColor(color)}
					>
						{value === color ? <span className={styles.check}>✓</span> : null}
					</button>
				))}
			</div>

			<div className={styles.customSection}>
				<button
					type="button"
					className={styles.customToggle}
					onClick={() => setShowCustomInput((shown) => !shown)}
				>
					{showCustomInput ? '隐藏' : '自定义颜色'}
				</button>
				{showCustomInput ? (
					<div className={styles.customInput}>
						<input
							type="color"
							className={styles.colorInput}
							value={customColor}
							onChange={(event) => selectColor(event.target.value)}
						/>
						<input
							type="text"
							className={styles.hexInput}
							value={customColor}
							placeholder="#667EEA"
							pattern="^#[0-9A-Fa-f]{6}$"
							onChange={(event) => {
								setCustomColor(event.target.value);
								onSelect(event.target.value);
							}}
						/>
					</div>
				) : null}
			</div>

			{value ? (
				<div className={styles.preview}>
					<span className={styles.previewLabel}>已选择：</span>
					<span className={styles.swatch} style={{ backgroundColor: value }} />
					<span className={styles.hex}>{value.toUpperCase()}</span>
					<button className={styles.clear} type="button" onClick={() => selectColor('')}>
						×
					</button>
				</div>
			) : null}
		</div>
	);
}
