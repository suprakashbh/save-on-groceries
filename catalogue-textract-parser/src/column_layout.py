def group_by_columns(lines, x_threshold=0.12):
    columns = []

    for line in sorted(lines, key=lambda l : l["left"]):
        placed = False

        for col in columns:
            if abs(col[0]["left"] - line["left"]) < x_threshold:
                col.append(line)
                placed = True
                break

        if not placed:
            columns.append ([line])

    return columns