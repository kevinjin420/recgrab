// Filtering + highlighting of the detailed-availability grid.
(() => {
	const RG = window.RG;
	const CLASS = {
		hiddenRow: 'rg-hidden-row',
		dimCell: 'rg-dim-cell',
		matchCell: 'rg-match-cell',
		matchRow: 'rg-match-row'
	};

	function clearDecorations(scan) {
		if (!scan) return;
		scan.rows.forEach((row) => {
			row.rowEl.classList.remove(CLASS.hiddenRow, CLASS.matchRow);
			row.dates.forEach((d) => d.cellEl.classList.remove(CLASS.dimCell, CLASS.matchCell));
		});
	}

	// Decide whether a date cell is a "match" the user would want to click.
	function isMatch(dateCell, config) {
		if (dateCell.state !== 'available') return false;
		const targets = (config.targetDates || []).filter(Boolean);
		if (targets.length && !targets.includes(dateCell.iso)) return false;
		if (dateCell.remaining == null) return true; // available but no count parsed
		return dateCell.remaining >= (config.groupSize || 1);
	}

	function apply(config) {
		const scan = RG.scanGrid();
		if (!scan) return { matched: 0, totalRows: 0 };
		clearDecorations(scan);

		if (!config.enabled) return { matched: 0, totalRows: scan.rows.length };

		let matched = 0;
		scan.rows.forEach((row) => {
			const inWatchlist = RG.matchesWatchlist(row, config.watchlist);

			if (!inWatchlist && config.hideNonMatchingRows) {
				row.rowEl.classList.add(CLASS.hiddenRow);
				return;
			}

			let rowHasMatch = false;
			row.dates.forEach((d) => {
				if (config.dimUnavailable && d.state !== 'available') {
					d.cellEl.classList.add(CLASS.dimCell);
				}
				if (isMatch(d, config)) {
					rowHasMatch = true;
					if (config.highlightMatches) d.cellEl.classList.add(CLASS.matchCell);
				}
			});

			if (rowHasMatch && inWatchlist) {
				row.rowEl.classList.add(CLASS.matchRow);
				matched++;
			}

			if (inWatchlist && !rowHasMatch && config.hideRowsWithNoMatch) {
				row.rowEl.classList.add(CLASS.hiddenRow);
			}
		});

		return { matched, totalRows: scan.rows.length };
	}

	window.RG.filter = { apply, clearDecorations, isMatch, CLASS };
})();
