// Filtering + highlighting of the detailed-availability grid.
(() => {
	const RG = window.RG;
	const CLASS = {
		hiddenRow: 'rg-hidden-row',
		mutedCell: 'rg-muted-cell',
		insufficientCell: 'rg-insufficient-cell',
		flexibleCell: 'rg-flexible-cell',
		targetCell: 'rg-target-cell',
		targetRow: 'rg-target-row'
	};

	function clearDecorations(scan) {
		if (!scan) return;
		scan.rows.forEach((row) => {
			row.rowEl.classList.remove(CLASS.hiddenRow, CLASS.targetRow);
			row.dates.forEach((d) => d.cellEl.classList.remove(
				CLASS.mutedCell, CLASS.insufficientCell, CLASS.flexibleCell, CLASS.targetCell
			));
		});
	}

	// Decide whether a date cell is a "match" the user would want to click.
	function isMatch(dateCell, config) {
		if (dateCell.state !== 'available') return false;
		if (config.targetDate && dateCell.iso !== config.targetDate) return false;
		if (dateCell.remaining == null) return true; // available but no count parsed
		return dateCell.remaining >= (config.groupSize || 1);
	}

	function hasEnoughSpots(dateCell, config) {
		if (dateCell.state !== 'available') return false;
		if (dateCell.remaining == null) return true;
		return dateCell.remaining >= (config.groupSize || 1);
	}

	function isFlexibleMatch(dateCell, config) {
		return !!(config.flexibleDates && config.targetDate &&
			dateCell.iso !== config.targetDate &&
			hasEnoughSpots(dateCell, config));
	}

	function isInsufficient(dateCell, config) {
		return dateCell.state === 'available' &&
			dateCell.remaining != null &&
			dateCell.remaining < (config.groupSize || 1);
	}

	function apply(config) {
		const scan = RG.scanGrid();
		if (!scan) return { matched: 0, totalRows: 0 };
		clearDecorations(scan);

		if (!config.enabled) return { matched: 0, totalRows: scan.rows.length };

		let matched = 0;
		const hasWatchlist = !!(config.watchlist && config.watchlist.length);
		scan.rows.forEach((row) => {
			const inWatchlist = hasWatchlist && RG.matchesWatchlist(row, config.watchlist);

			if (hasWatchlist && !inWatchlist && config.hideNonMatchingRows) {
				row.rowEl.classList.add(CLASS.hiddenRow);
				return;
			}

			let rowHasMatch = false;
			row.dates.forEach((d) => {
				const actionable = inWatchlist && isMatch(d, config);
				if (actionable) {
					rowHasMatch = true;
					d.cellEl.classList.add(CLASS.targetCell);
					return;
				}
				if (inWatchlist && isFlexibleMatch(d, config)) {
					d.cellEl.classList.add(CLASS.flexibleCell);
					return;
				}
				if (inWatchlist && isInsufficient(d, config)) {
					d.cellEl.classList.add(CLASS.insufficientCell);
					return;
				}
				if (inWatchlist && d.state === 'available') return;
				d.cellEl.classList.add(CLASS.mutedCell);
			});

			if (rowHasMatch) {
				row.rowEl.classList.add(CLASS.targetRow);
				matched++;
			}
		});

		return { matched, totalRows: scan.rows.length };
	}

	window.RG.filter = { apply, clearDecorations, isMatch, isFlexibleMatch, isInsufficient, CLASS };
})();
